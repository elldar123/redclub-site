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
const providerConfig = {
  pragmatic: { baseUrl: process.env.PRAGMATIC_BASE_URL, token: process.env.PRAGMATIC_API_TOKEN, secret: process.env.PRAGMATIC_SECRET_KEY, agentId: process.env.PRAGMATIC_AGENT_ID },
  amatic: { baseUrl: process.env.AMATIC_BASE_URL, token: process.env.AMATIC_API_TOKEN, secret: process.env.AMATIC_SECRET_KEY, agentId: process.env.AMATIC_AGENT_ID },
  pgsoft: { baseUrl: process.env.PGSOFT_BASE_URL, token: process.env.PGSOFT_API_TOKEN, secret: process.env.PGSOFT_SECRET_KEY, agentId: process.env.PGSOFT_AGENT_ID },
  amusnet: { baseUrl: process.env.AMUSNET_BASE_URL, token: process.env.AMUSNET_API_TOKEN, secret: process.env.AMUSNET_SECRET_KEY, agentId: process.env.AMUSNET_AGENT_ID },
};

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && parsed.pathname === '/api/health') {
      const activeProvider = process.env.APILX_PROVIDER || 'pragmatic';
      return sendJson(res, 200, { ok: true, configured: Boolean(providerConfig[activeProvider]?.token), provider: activeProvider, currency: process.env.APILX_CURRENCY || null });
    }
    if (req.method === 'GET' && parsed.pathname === '/api/callback/apilx') {
      return sendJson(res, 200, { ok: true, endpoint: '/api/callback/apilx', method: 'POST', message: 'API LX callback endpoint is ready. Provider callbacks must use POST.' });
    }
    if (req.method === 'GET' && parsed.pathname === '/api/providers') return sendJson(res, 200, providers);
    if (req.method === 'GET' && parsed.pathname === '/api/games') return listGames(res, parsed.searchParams.get('provider') || process.env.APILX_PROVIDER || 'pragmatic');
    if (req.method === 'POST' && parsed.pathname === '/api/launch') return launchGame(req, res);
    if (req.method === 'POST' && parsed.pathname.startsWith('/api/callback/apilx')) return handleCallback(req, res, parsed.pathname.split('/').filter(Boolean).pop());
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
  const provider = body.provider || process.env.APILX_PROVIDER || 'pragmatic';
  const config = providerConfig[provider];
  if (!config?.token || !config?.baseUrl) return sendJson(res, 503, { error: `API LX provider ${provider} is not configured yet`, setupRequired: true });

  const upstream = await fetch(new URL(process.env.APILX_LAUNCH_PATH || '/userAuth', config.baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, 'x-api-token': config.token },
    body: JSON.stringify({ agentID: config.agentId, userID: body.userId, lang: body.lang || 'az', gameid: Number(body.gameId), isaffiliate: false, lobbyUrl: body.lobbyUrl || process.env.APILX_LOBBY_URL || 'https://redplayco.com' }),
  });
  const data = await upstream.json().catch(() => ({}));
  sendJson(res, upstream.status, data);
}

async function listGames(res, provider) {
  if (provider === 'all') {
    const results = await Promise.all(Object.keys(providerConfig).map(async id => {
      const config = providerConfig[id];
      if (!config?.token || !config?.baseUrl) return [];
      const upstream = await fetch(new URL(process.env.APILX_GAMES_PATH || '/gamelist', config.baseUrl), { headers: { accept: 'application/json', authorization: `Bearer ${config.token}` } });
      const data = await upstream.json().catch(() => ({}));
      return (Array.isArray(data.data) ? data.data : []).map(game => ({ ...game, provider: id }));
    }));
    return sendJson(res, 200, { code: 0, message: 'OK', data: results.flat() });
  }
  const config = providerConfig[provider];
  if (!config?.token || !config?.baseUrl) return sendJson(res, 503, { error: `API LX provider ${provider} is not configured yet`, setupRequired: true });
  const upstream = await fetch(new URL(process.env.APILX_GAMES_PATH || '/gamelist', config.baseUrl), { headers: { accept: 'application/json', authorization: `Bearer ${config.token}` } });
  const data = await upstream.json().catch(() => ({}));
  sendJson(res, upstream.status, data);
}

const balances = new Map();
const transactions = new Map();
async function handleCallback(req, res, operation) {
  const body = await readJson(req);
  const op = body.operation || operation;
  const config = Object.values(providerConfig).find(item => item.agentId === body.agentID);
  if (!config || !verifySignature(body, config.secret, op)) return sendJson(res, 200, { code: 3, message: 'Invalid Sign' });
  const userId = body.userID;
  if (!userId) return sendJson(res, 200, { code: 2, message: 'Invalid user id' });
  if (!balances.has(userId)) balances.set(userId, 0);
  let balance = balances.get(userId);
  if (op === 'GetBalance') return sendJson(res, 200, { code: 0, message: '', balance: round(balance) });
  const txId = body.transactionID || body.refTransactionID;
  if (op === 'RollbackTransaction') {
    const original = transactions.get(body.refTransactionID);
    if (!original || original.rolledBack) return sendJson(res, 200, { code: 1, message: 'General Error' });
    balance = round(balance - original.delta); balances.set(userId, balance); original.rolledBack = true;
    return sendJson(res, 200, { code: 0, message: '' });
  }
  if (txId && transactions.has(txId)) return sendJson(res, 200, { code: 0, message: '', platformTransactionID: txId, balance: round(balance) });
  let delta = 0;
  if (op === 'Withdraw') delta = -Number(body.amount || 0);
  else if (op === 'Deposit') delta = Number(body.amount || 0);
  else if (op === 'BetWin') delta = Number(body.winAmount || 0) - Number(body.betAmount || 0);
  else return sendJson(res, 200, { code: 2, message: 'Unknown operation' });
  if (balance + delta < 0) return sendJson(res, 200, { code: 6, message: 'Insufficient funds' });
  balance = round(balance + delta); balances.set(userId, balance);
  if (txId) transactions.set(txId, { userId, delta, rolledBack: false });
  sendJson(res, 200, { code: 0, message: '', platformTransactionID: txId || crypto.randomUUID(), balance: round(balance) });
}

function verifySignature(body, secret, operation) {
  if (!secret || !body.sign) return false;
  const amount = value => Number(value || 0).toFixed(2);
  const messages = {
    GetBalance: `${body.agentID}${body.userID}${body.gameID || ''}`,
    Withdraw: `${body.agentID}${body.userID}${amount(body.amount)}${body.transactionID}${body.roundID}`,
    Deposit: `${body.agentID}${body.userID}${amount(body.amount)}${body.refTransactionID}${body.transactionID}${body.roundID}`,
    BetWin: `${body.agentID}${body.userID}${amount(body.betAmount)}${amount(body.winAmount)}${body.transactionID}${body.roundID}`,
    RollbackTransaction: `${body.agentID}${body.userID}${body.refTransactionID}`,
  };
  const expected = crypto.createHmac('sha256', secret).update(messages[operation] || '').digest('hex').toUpperCase();
  return expected.length === body.sign.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(body.sign.toUpperCase()));
}
function round(value) { return Math.round(Number(value) * 100) / 100; }

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
