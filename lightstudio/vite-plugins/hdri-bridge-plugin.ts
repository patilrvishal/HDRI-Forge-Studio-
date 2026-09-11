import type { Plugin, ViteDevServer } from 'vite';

const ENDPOINT = '/__hdri_bridge_push';
const WS_EVENT = 'hdri-bridge:scene-update';

/**
 * Dev-only bridge: accepts an HTTP POST from the Blender addon and rebroadcasts
 * the payload to every connected client over Vite's existing HMR WebSocket, so
 * no separate server/port is needed.
 */
export function hdriBridgePlugin(): Plugin {
  let lastPayload: string | null = null;

  return {
    name: 'hdri-bridge',
    configureServer(server: ViteDevServer) {
      // Re-send the last payload when a new WS client connects (e.g. page reload)
      server.ws.on('connection', () => {
        if (lastPayload) {
          server.ws.send({ type: 'custom', event: WS_EVENT, data: JSON.parse(lastPayload) });
        }
      });

      server.middlewares.use(ENDPOINT, (req, res) => {
        // Lightweight presence check - lets the Blender addon auto-detect
        // "is the dev server here?" without performing a real push.
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, app: 'HDRI Forge Studio', mode: 'dev' }));
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end('Method Not Allowed');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const payload = JSON.parse(body);
            lastPayload = body;
            server.ws.send({ type: 'custom', event: WS_EVENT, data: payload });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400).end('Bad JSON');
          }
        });
      });
    },
  };
}
