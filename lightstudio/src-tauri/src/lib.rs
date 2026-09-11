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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      start_hdri_bridge_server(app.handle().clone());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
