use std::io::{Read, Write};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

/// Port the desktop build's HDRI Bridge HTTP listener binds to. Deliberately
/// different from Vite's dev-server port (5173) so a `npm run dev` session
/// and the built app can each run their own bridge without colliding.
const HDRI_BRIDGE_PORT: u16 = 8973;
const HDRI_BRIDGE_PATH: &str = "/__hdri_bridge_push";
const HDRI_BRIDGE_EVENT: &str = "hdri-bridge:scene-update";

/// Mirrors the dev-server Vite plugin (vite-plugins/hdri-bridge-plugin.ts):
/// accepts a POST from the Blender addon and rebroadcasts the payload, but
/// over a Tauri event instead of a Vite HMR WebSocket message, since a built
/// app has no dev server to carry that channel.
fn start_hdri_bridge_server(app_handle: tauri::AppHandle) {
  std::thread::spawn(move || {
    let addr = format!("127.0.0.1:{HDRI_BRIDGE_PORT}");
    let server = match tiny_http::Server::http(&addr) {
      Ok(s) => s,
      Err(e) => {
        log::error!("[HDRI Bridge] failed to bind {addr}: {e}");
        return;
      }
    };
    log::info!("[HDRI Bridge] listening on http://{addr}{HDRI_BRIDGE_PATH}");

    for mut request in server.incoming_requests() {
      let path_ok = request.url() == HDRI_BRIDGE_PATH;

      // GET is a lightweight presence check (no payload) - lets a client like
      // the Blender addon auto-detect "is the desktop app here?" without
      // performing a real push.
      if path_ok && matches!(request.method(), tiny_http::Method::Get) {
        let _ = request.respond(
          tiny_http::Response::from_string("{\"ok\":true,\"app\":\"HDRI Forge Studio\",\"mode\":\"desktop\"}")
            .with_status_code(200)
            .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()),
        );
        continue;
      }

      let method_ok = matches!(request.method(), tiny_http::Method::Post);

      if !path_ok {
        let _ = request.respond(tiny_http::Response::from_string("Not Found").with_status_code(404));
        continue;
      }
      if !method_ok {
        let _ = request.respond(tiny_http::Response::from_string("Method Not Allowed").with_status_code(405));
        continue;
      }

      let mut body = String::new();
      if let Err(e) = std::io::Read::read_to_string(request.as_reader(), &mut body) {
        log::warn!("[HDRI Bridge] failed to read request body: {e}");
        let _ = request.respond(tiny_http::Response::from_string("Bad Request").with_status_code(400));
        continue;
      }

      match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(payload) => {
          if let Err(e) = app_handle.emit(HDRI_BRIDGE_EVENT, payload) {
            log::error!("[HDRI Bridge] failed to emit event: {e}");
          }
          let _ = request.respond(
            tiny_http::Response::from_string("{\"ok\":true}")
              .with_status_code(200)
              .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()),
          );
        }
        Err(e) => {
          log::warn!("[HDRI Bridge] bad JSON: {e}");
          let _ = request.respond(tiny_http::Response::from_string("Bad JSON").with_status_code(400));
        }
      }
    }
  });
}

// ───────────────────────── Erik live link bridge ─────────────────────────
// Desktop-build twin of vite-plugins/erik-live-plugin.ts: the Forge page POSTs
// the HDRI it just rendered to /__erik_live/push, and any open Erik Adjuster
// tab follows it over Server-Sent Events and downloads /hdr + /ash. Only the
// latest map is kept in memory. Binds the first free port in 5173..=5180 (5173
// is what the Erik panel defaults to) and only listens on loopback.

static ERIK_LIVE_PORT: AtomicU16 = AtomicU16::new(0);

#[derive(Default)]
struct ErikLiveState {
  version: u64,
  hdr: Vec<u8>,
  ash: String,
  meta: serde_json::Map<String, serde_json::Value>,
  clients: Vec<Box<dyn Write + Send>>,
  /// Forge page listening for messages Erik sends back ("match reference photo" gains).
  up_clients: Vec<Box<dyn Write + Send>>,
}

fn erik_header(k: &str, v: &str) -> tiny_http::Header {
  tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn erik_cors<R: Read>(mut r: tiny_http::Response<R>) -> tiny_http::Response<R> {
  for (k, v) in [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
    ("Access-Control-Allow-Headers", "*"),
    ("Access-Control-Expose-Headers", "*"),
    ("Cache-Control", "no-store"),
  ] {
    r.add_header(erik_header(k, v));
  }
  r
}

/// Percent-decoder for the encodeURIComponent'd X-Ash / X-Meta headers.
fn erik_percent_decode(s: &str) -> String {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    if b[i] == b'%' && i + 2 < b.len() {
      if let Ok(hex) = std::str::from_utf8(&b[i + 1..i + 3]) {
        if let Ok(v) = u8::from_str_radix(hex, 16) {
          out.push(v);
          i += 3;
          continue;
        }
      }
    }
    out.push(b[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

fn erik_event(g: &ErikLiveState) -> String {
  let mut obj = g.meta.clone();
  obj.insert("v".into(), g.version.into());
  format!("data: {}\n\n", serde_json::Value::Object(obj))
}

fn erik_broadcast(g: &mut ErikLiveState) {
  let msg = erik_event(g);
  g.clients
    .retain_mut(|c| c.write_all(msg.as_bytes()).and_then(|_| c.flush()).is_ok());
}

fn erik_json<R: Read>(r: tiny_http::Response<R>) -> tiny_http::Response<R> {
  erik_cors(r.with_header(erik_header("Content-Type", "application/json")))
}

/// Which port the Erik live bridge ended up on (0 = could not bind). Called by the frontend.
#[tauri::command]
fn erik_live_port() -> u16 {
  ERIK_LIVE_PORT.load(Ordering::SeqCst)
}

fn start_erik_live_server() {
  // Bind synchronously so erik_live_port() is correct as soon as the window exists.
  let mut bound = None;
  for port in 5173u16..=5180 {
    if let Ok(s) = tiny_http::Server::http(format!("127.0.0.1:{port}")) {
      ERIK_LIVE_PORT.store(port, Ordering::SeqCst);
      bound = Some(s);
      break;
    }
  }
  let Some(server) = bound else {
    log::error!("[Erik Live] no free port in 5173-5180; live link unavailable");
    return;
  };
  log::info!("[Erik Live] bridge listening on 127.0.0.1:{}", ERIK_LIVE_PORT.load(Ordering::SeqCst));

  let state = Arc::new(Mutex::new(ErikLiveState::default()));

  {
    let st = state.clone();
    std::thread::spawn(move || loop {
      std::thread::sleep(Duration::from_secs(15));
      if let Ok(mut g) = st.lock() {
        g.clients
          .retain_mut(|c| c.write_all(b": ping\n\n").and_then(|_| c.flush()).is_ok());
        g.up_clients
          .retain_mut(|c| c.write_all(b": ping\n\n").and_then(|_| c.flush()).is_ok());
      }
    });
  }

  std::thread::spawn(move || {
    for mut request in server.incoming_requests() {
      let method = request.method().clone();
      let full = request.url().to_string();
      let url = full.split('?').next().unwrap_or("");
      let Some(path) = url.strip_prefix("/__erik_live") else {
        let _ = request.respond(tiny_http::Response::from_string("Not Found").with_status_code(404));
        continue;
      };
      let path = path.to_string();

      match (method, path.as_str()) {
        (tiny_http::Method::Options, _) => {
          let _ = request.respond(erik_cors(tiny_http::Response::empty(204)));
        }
        (tiny_http::Method::Get, "/status") => {
          let body = {
            let g = state.lock().unwrap();
            let mut obj = g.meta.clone();
            obj.insert("ok".into(), true.into());
            obj.insert("app".into(), "HDRI Forge Studio".into());
            obj.insert("mode".into(), "desktop".into());
            obj.insert("version".into(), g.version.into());
            obj.insert("clients".into(), g.clients.len().into());
            obj.insert("forge".into(), g.up_clients.len().into());
            obj.insert("hasMap".into(), (!g.hdr.is_empty()).into());
            serde_json::Value::Object(obj).to_string()
          };
          let _ = request.respond(erik_json(tiny_http::Response::from_string(body)));
        }
        (tiny_http::Method::Get, "/events") => {
          let mut w = request.into_writer();
          let mut g = state.lock().unwrap();
          let first = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
            erik_event(&g)
          );
          if w.write_all(first.as_bytes()).and_then(|_| w.flush()).is_ok() {
            g.clients.push(w);
          }
        }
        (tiny_http::Method::Get, "/up-events") => {
          let mut w = request.into_writer();
          let mut g = state.lock().unwrap();
          let first = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n: ok\n\n";
          if w.write_all(first.as_bytes()).and_then(|_| w.flush()).is_ok() {
            g.up_clients.push(w);
          }
        }
        (tiny_http::Method::Post, "/up") => {
          let mut body = Vec::new();
          let read_ok = std::io::Read::read_to_end(&mut request.as_reader().take(4097), &mut body).is_ok();
          let parsed = if read_ok && body.len() <= 4096 {
            serde_json::from_slice::<serde_json::Value>(&body).ok()
          } else {
            None
          };
          match parsed {
            Some(v) => {
              let msg = format!("data: {}\n\n", v);
              let listeners = {
                let mut g = state.lock().unwrap();
                g.up_clients
                  .retain_mut(|c| c.write_all(msg.as_bytes()).and_then(|_| c.flush()).is_ok());
                g.up_clients.len()
              };
              let _ = request.respond(erik_json(tiny_http::Response::from_string(format!(
                "{{\"ok\":true,\"listeners\":{listeners}}}"
              ))));
            }
            None => {
              let _ = request.respond(erik_cors(tiny_http::Response::from_string("bad message").with_status_code(400)));
            }
          }
        }
        (tiny_http::Method::Get, "/hdr") => {
          let data = state.lock().unwrap().hdr.clone();
          if data.is_empty() {
            let _ = request.respond(erik_cors(tiny_http::Response::from_string("no map yet").with_status_code(404)));
          } else {
            let _ = request.respond(erik_cors(
              tiny_http::Response::from_data(data).with_header(erik_header("Content-Type", "application/octet-stream")),
            ));
          }
        }
        (tiny_http::Method::Get, "/ash") => {
          let ash = state.lock().unwrap().ash.clone();
          if ash.is_empty() {
            let _ = request.respond(erik_cors(tiny_http::Response::from_string("no sh yet").with_status_code(404)));
          } else {
            let _ = request.respond(erik_cors(
              tiny_http::Response::from_string(ash).with_header(erik_header("Content-Type", "text/plain")),
            ));
          }
        }
        (tiny_http::Method::Post, "/push") => {
          let mut ash = String::new();
          let mut meta_raw = String::new();
          for h in request.headers() {
            if h.field.equiv("X-Ash") {
              ash = erik_percent_decode(h.value.as_str());
            } else if h.field.equiv("X-Meta") {
              meta_raw = erik_percent_decode(h.value.as_str());
            }
          }
          let mut body = Vec::new();
          if std::io::Read::read_to_end(request.as_reader(), &mut body).is_err() {
            let _ = request.respond(erik_cors(tiny_http::Response::from_string("bad push").with_status_code(400)));
            continue;
          }
          let (version, clients) = {
            let mut g = state.lock().unwrap();
            g.hdr = body;
            g.ash = ash;
            if let Ok(serde_json::Value::Object(m)) = serde_json::from_str::<serde_json::Value>(&meta_raw) {
              g.meta = m;
            }
            g.version += 1;
            erik_broadcast(&mut g);
            (g.version, g.clients.len())
          };
          let _ = request.respond(erik_json(tiny_http::Response::from_string(format!(
            "{{\"ok\":true,\"version\":{version},\"clients\":{clients}}}"
          ))));
        }
        _ => {
          let _ = request.respond(erik_cors(tiny_http::Response::from_string("not found").with_status_code(404)));
        }
      }
    }
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![erik_live_port])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      start_hdri_bridge_server(app.handle().clone());
      start_erik_live_server();
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
