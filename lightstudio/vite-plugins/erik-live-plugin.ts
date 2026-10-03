import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

const BASE = '/__erik_live';

/**
 * Dev-only link between HDRI Forge Studio and the Erik Adjuster.
 *
 *   Forge page  --POST /push (RLE .hdr bytes + X-Ash header)-->  this plugin
 *   Erik page   <--SSE /events  (version ping)--               this plugin
 *   Erik page   --GET /hdr, /ash-->                            this plugin
 *
 * Only the latest map is kept in memory, so a slow Erik never builds a backlog.
 * CORS is wide open because Erik is served from a different localhost port; this
 * only exists while `npm run dev` runs.
 */
export function erikLivePlugin(): Plugin {
  let version = 0;
  let hdr: Buffer | null = null;
  let ash = '';
  let meta = { w: 0, h: 0, ms: 0, pass: '' };
  const clients = new Set<ServerResponse>();

  const cors = (res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Cache-Control', 'no-store');
  };

  const broadcast = () => {
    const msg = `data: ${JSON.stringify({ v: version, ...meta })}\n\n`;
    for (const c of clients) c.write(msg);
  };

  return {
    name: 'erik-live',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(BASE, (req: IncomingMessage, res: ServerResponse) => {
        cors(res);
        const url = (req.url ?? '/').split('?')[0];
        if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

        if (req.method === 'GET' && url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, app: 'HDRI Forge Studio', version, clients: clients.size, hasMap: !!hdr, ...meta }));
          return;
        }

        if (req.method === 'GET' && url === '/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify({ v: version, ...meta })}\n\n`);
          clients.add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 15000);
          req.on('close', () => { clearInterval(ping); clients.delete(res); });
          return;
        }

        if (req.method === 'GET' && url === '/hdr') {
          if (!hdr) { res.writeHead(404).end('no map yet'); return; }
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': hdr.length });
          res.end(hdr);
          return;
        }

        if (req.method === 'GET' && url === '/ash') {
          if (!ash) { res.writeHead(404).end('no sh yet'); return; }
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(ash);
          return;
        }

        if (req.method === 'POST' && url === '/push') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            try {
              hdr = Buffer.concat(chunks);
              const xa = req.headers['x-ash'];
              ash = typeof xa === 'string' ? decodeURIComponent(xa) : '';
              const xm = req.headers['x-meta'];
              meta = typeof xm === 'string' ? JSON.parse(decodeURIComponent(xm)) : meta;
              version++;
              broadcast();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, version, clients: clients.size }));
            } catch {
              res.writeHead(400).end('bad push');
            }
          });
          return;
        }

        res.writeHead(404).end('not found');
      });
    },
  };
}
