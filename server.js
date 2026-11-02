const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
loadEnv();
const port = Number(process.env.PORT || 5500);
const providers = [
  { id: 'pragmatic', name: 'Pragmatic Play', docs: 'https://documenter.getpostman.com/view/25695248/2sA3Qy7VR4' },
  { id: 'pgsoft', name: 'PG Soft', docs: 'https://documenter.getpostman.com/view/25695248/2sA2xb5v4x' },
  { id: 'amatic', name: 'Amatic', docs: 'https://documenter.getpostman.com/view/25695248/2sA358dkaT' },
  { id: 'amusnet', name: 'Amusnet', docs: 'https://documenter.getpostman.com/view/25695248/2sBXVbHZch' },
];

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && parsed.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, configured: Boolean(process.env.APILX_TOKEN), currency: process.env.APILX_CURRENCY || null });
    }
    if (req.method === 'GET' && parsed.pathname === '/api/callback/apilx') {
      return sendJson(res, 200, { ok: true, endpoint: '/api/callback/apilx', method: 'POST', message: 'API LX callback endpoint is ready. Provider callbacks must use POST.' });
    }
    if (req.method === 'GET' && parsed.pathname === '/api/providers') return sendJson(res, 200, providers);
    if (req.method === 'POST' && parsed.pathname === '/api/launch') return launchGame(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/callback/apilx') return handleCallback(req, res);
    if (req.method === 'GET') return serveStatic(parsed.pathname, res);
    sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

async function launchGame(req, res) {
  const body = await readJson(req);
  if (!body.gameId || !body.userId) return sendJson(res, 400, { error: 'gameId and userId are required' });
  if (!process.env.APILX_TOKEN) return sendJson(res, 503, { error: 'API LX is not configured yet', setupRequired: true });

  // Confirm the exact launch path and payload in API LX documentation before enabling production.
  const upstream = await fetch(new URL(process.env.APILX_LAUNCH_PATH || '/v1/games/launch', process.env.APILX_BASE_URL), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.APILX_TOKEN}` },
    body: JSON.stringify({ provider: body.provider || process.env.APILX_PROVIDER, gameId: body.gameId, userId: body.userId, currency: process.env.APILX_CURRENCY, callbackUrl: process.env.APILX_CALLBACK_URL, mode: body.mode || 'real' }),
  });
  const data = await upstream.json().catch(() => ({}));
  sendJson(res, upstream.status, data);
}

async function handleCallback(req, res) {
  const body = await readJson(req);
  // TODO: validate API LX signature according to the provider documentation before crediting balances.
  console.log(`[API LX callback] ${new Date().toISOString()}`, { event: body.event, userId: body.userId });
  sendJson(res, 200, { received: true, callbackId: crypto.randomUUID() });
}

function serveStatic(requestPath, res) {
  const clean = requestPath === '/' ? '/index.html' : requestPath;
  const file = path.resolve(root, `.${clean}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(res, 404, { error: 'Not found' });
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
function readJson(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
function sendJson(res, status, data) { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)); }
function loadEnv() { const file = path.join(root, '.env'); if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const match = line.match(/^([A-Z0-9_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); } }

server.listen(port, () => console.log(`REDX server running at http://localhost:${port}`));
