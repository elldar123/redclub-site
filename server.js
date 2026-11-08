const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { attachLoto } = require('./loto-server');
const database = require('./database');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

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
const ggx = { baseUrl: process.env.GGX_BASE_URL, clientId: process.env.GGX_CLIENT_ID, clientSecret: process.env.GGX_CLIENT_SECRET };
let ggxToken = null;

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && parsed.pathname === '/api/health') {
      const activeProvider = process.env.APILX_PROVIDER || 'pragmatic';
      return sendJson(res, 200, { ok: true, configured: Boolean(providerConfig[activeProvider]?.token), provider: activeProvider, currency: process.env.APILX_CURRENCY || null });
    }
    if (req.method === 'GET' && parsed.pathname === '/api/admin/status') return sendJson(res, 200, { configured: Boolean(process.env.DATABASE_URL), productionReady: Boolean(process.env.DATABASE_URL && process.env.ADMIN_JWT_SECRET) });
    if (req.method === 'POST' && parsed.pathname === '/api/admin/login') return adminLogin(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/admin/2fa/setup') return admin2faSetup(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/admin/2fa/verify') return admin2faVerify(req, res);
    if (req.method === 'GET' && parsed.pathname === '/api/admin/affiliates') return adminAffiliates(req, res, false);
    if (req.method === 'POST' && parsed.pathname === '/api/admin/affiliates') return adminAffiliates(req, res, true);
    if (req.method === 'GET' && parsed.pathname === '/api/admin/users') return adminUsers(req, res);
    if (req.method === 'GET' && parsed.pathname === '/api/admin/promos') return adminPromos(req, res, false);
    if (req.method === 'POST' && parsed.pathname === '/api/admin/promos') return adminPromos(req, res, true);
    if (req.method === 'GET' && parsed.pathname === '/api/admin/bonuses') return adminBonuses(req, res, false);
    if (req.method === 'POST' && parsed.pathname === '/api/admin/bonuses') return adminBonuses(req, res, true);
    if (req.method === 'GET' && parsed.pathname === '/api/admin/providers') return adminProviders(req, res, false);
    if (req.method === 'POST' && parsed.pathname === '/api/admin/providers') return adminProviders(req, res, true);
    if (req.method === 'POST' && parsed.pathname === '/api/auth/register') return userRegister(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/auth/login') return userLogin(req, res);
    if (req.method === 'GET' && parsed.pathname === '/api/callback/apilx') {
      return sendJson(res, 200, { ok: true, endpoint: '/api/callback/apilx', method: 'POST', message: 'API LX callback endpoint is ready. Provider callbacks must use POST.' });
    }
    if (req.method === 'GET' && parsed.pathname === '/api/providers') return sendJson(res, 200, providers);
    if (req.method === 'GET' && parsed.pathname === '/api/goldengatex/vendors') return ggxRequest(res, '/vendors/list', { method: 'GET' });
    if (req.method === 'POST' && parsed.pathname === '/api/goldengatex/games') return handleGgxGames(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/goldengatex/launch') return handleGgxLaunch(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/balance') return handleGgxBalance(req, res);
    if (req.method === 'POST' && parsed.pathname === '/api/transaction') return handleGgxTransaction(req, res);
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
const lotoWss = new WebSocketServer({ server });
attachLoto(lotoWss);

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

async function getGgxToken() {
  if (!ggx.baseUrl || !ggx.clientId || !ggx.clientSecret) throw new Error('GoldenGateX is not configured');
  if (ggxToken && ggxToken.expiresAt > Date.now() + 30000) return ggxToken.value;
  const response = await fetch(new URL('auth/createtoken', ggx.baseUrl), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ clientId: ggx.clientId, clientSecret: ggx.clientSecret }) });
  const raw = await response.text(); let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  const token = (typeof data === 'string' ? data : data.token) || (response.ok && raw.trim() ? raw.trim().replace(/^"|"$/g, '') : '');
  if (!response.ok || !token) throw new Error(`GoldenGateX token HTTP ${response.status}: ${data.message || raw.slice(0,120) || 'empty response'}`);
  ggxToken = { value: token, expiresAt: Number(data.expiration || 0) * 1000 || Date.now() + 300000 };
  return ggxToken.value;
}
async function ggxRequest(res, route, options = {}) { try { const token = await getGgxToken(); const response = await fetch(new URL(route.replace(/^\/+/,''), ggx.baseUrl), { ...options, headers: { accept:'application/json', authorization:`Bearer ${token}`, ...(options.headers || {}) } }); const raw=await response.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={success:false,errorCode:response.status,message:raw.slice(0,500)}}; if(!raw)data={success:false,errorCode:response.status,message:'GoldenGateX returned an empty response'}; sendJson(res, response.status, data); } catch (error) { sendJson(res, 503, { success:false, error:error.message, setupRequired:true }); } }
async function handleGgxGames(req, res) { const body = await readJson(req); return ggxRequest(res, '/games/list', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ vendorCode: body.vendorCode, language: body.language || 'az' }) }); }
async function handleGgxLaunch(req, res) { const body = await readJson(req); return ggxRequest(res, '/game/launch-url', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ vendorCode:body.vendorCode, gameCode:body.gameCode, userCode:body.userCode, language:body.language || 'az', lobbyUrl:body.lobbyUrl || 'https://redplayco.com', theme:body.theme }) }); }
function validGgxAuth(req) { const expected = `Basic ${Buffer.from(`${ggx.clientId}:${ggx.clientSecret}`).toString('base64')}`; const actual = req.headers.authorization || ''; return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
async function handleGgxBalance(req, res) { if (!validGgxAuth(req)) return sendJson(res, 200, {success:false,message:0,errorCode:401}); const body=await readJson(req); const balance=database.enabled?await database.getBalance(body.userCode):round(balances.get(body.userCode)||0); sendJson(res,200,{success:true,message:balance,errorCode:0}); }
async function handleGgxTransaction(req, res) { if (!validGgxAuth(req)) return sendJson(res,200,{success:false,message:0,errorCode:401}); const body=await readJson(req); const user=body.userCode; const tx=String(body.transactionCode||body.historyId); if (!user || !tx) return sendJson(res,200,{success:false,message:0,errorCode:400}); if (database.enabled) { const result=await database.applyWalletTransaction({userCode:user,externalId:`ggx:${tx}`,amount:Number(body.isCanceled)?0:Number(body.amount||0),kind:Number(body.amount||0)<0?'bet':'win',provider:'goldengatex',metadata:body}); return sendJson(res,200,{success:!result.insufficient,message:result.balance,errorCode:result.insufficient?4:0}); } if (transactions.has(`ggx:${tx}`)) return sendJson(res,200,{success:false,message:round(balances.get(user)||0),errorCode:6}); const current=Number(balances.get(user)||0); const delta=Number(body.isCanceled) ? 0 : Number(body.amount||0); if (current+delta<0) return sendJson(res,200,{success:false,message:round(current),errorCode:4}); balances.set(user,round(current+delta)); transactions.set(`ggx:${tx}`,{user,delta}); sendJson(res,200,{success:true,message:round(current+delta),errorCode:0}); }
async function adminLogin(req,res){ if(!database.enabled||!process.env.ADMIN_JWT_SECRET)return sendJson(res,503,{error:'Admin database is not configured yet'});const body=await readJson(req);const admin=await database.authenticateAdmin(body.email||'',body.password||'');if(!admin)return sendJson(res,401,{error:'Invalid admin credentials'});if(admin.totpEnabled&&!body.otp)return sendJson(res,401,{error:'Authenticator code required',twoFactorRequired:true});if(admin.totpEnabled&&!authenticator.check(String(body.otp),admin.totpSecret))return sendJson(res,401,{error:'Invalid authenticator code',twoFactorRequired:true});delete admin.totpSecret;delete admin.totpEnabled;sendJson(res,200,{token:jwt.sign(admin,process.env.ADMIN_JWT_SECRET,{expiresIn:'8h'}),admin}); }
async function userRegister(req,res){ if(!database.enabled||!process.env.ADMIN_JWT_SECRET)return sendJson(res,503,{error:'User database is not configured yet'});const body=await readJson(req);if(!/^\S+@\S+\.\S+$/.test(body.email||'')||String(body.password||'').length<8)return sendJson(res,400,{error:'Email and an 8-character password are required'});const countries={AZ:{currency:'AZN',language:'az'},TR:{currency:'TRY',language:'tr'},KZ:{currency:'KZT',language:'kk'},RU:{currency:'RUB',language:'ru'},UZ:{currency:'UZS',language:'uz'}};const country=countries[body.country] ? body.country : 'AZ';const currency=body.currency&&['AZN','TRY','KZT','RUB','USD','UZS'].includes(body.currency)?body.currency:countries[country].currency;try{const user=await database.createUser(body.email,body.password,currency,country,body.language||countries[country].language,body.referralCode||'');sendJson(res,201,{token:jwt.sign({id:user.id,externalCode:user.external_code,email:user.email},process.env.ADMIN_JWT_SECRET,{expiresIn:'30d'}),user});}catch(error){sendJson(res,error.code==='23505'?409:500,{error:error.code==='23505'?'Email already registered':'Registration failed'});}}
async function userLogin(req,res){ if(!database.enabled||!process.env.ADMIN_JWT_SECRET)return sendJson(res,503,{error:'User database is not configured yet'});const body=await readJson(req);const user=await database.authenticateUser(body.email||'',body.password||'');if(!user)return sendJson(res,401,{error:'Invalid email or password'});sendJson(res,200,{token:jwt.sign({id:user.id,externalCode:user.external_code,email:user.email},process.env.ADMIN_JWT_SECRET,{expiresIn:'30d'}),user});}
function adminAuth(req){try{const header=req.headers.authorization||'';if(!header.startsWith('Bearer ')||!process.env.ADMIN_JWT_SECRET)return null;return jwt.verify(header.slice(7),process.env.ADMIN_JWT_SECRET)}catch{return null}}
async function adminAffiliates(req,res,create){if(!database.enabled)return sendJson(res,503,{error:'Database is not configured'});if(!adminAuth(req))return sendJson(res,401,{error:'Admin authentication required'});try{if(create){const body=await readJson(req);if(!body.code||!body.name||Number(body.rate)<0||Number(body.rate)>100)return sendJson(res,400,{error:'Valid code, name and rate are required'});return sendJson(res,201,await database.createAffiliate(body.code,body.name,Number(body.rate)))}sendJson(res,200,{affiliates:await database.listAffiliates()})}catch(error){sendJson(res,error.code==='23505'?409:500,{error:error.code==='23505'?'Affiliate code already exists':'Affiliate operation failed'})}}
async function admin2faSetup(req,res){const admin=adminAuth(req);if(!admin)return sendJson(res,401,{error:'Admin authentication required'});const secret=authenticator.generateSecret();await database.saveTotp(admin.id,secret);const uri=authenticator.keyuri(admin.email,'REDX Admin',secret);sendJson(res,200,{secret,qrCode:await QRCode.toDataURL(uri),message:'Scan QR and confirm with a code'});}
async function admin2faVerify(req,res){const admin=adminAuth(req);if(!admin)return sendJson(res,401,{error:'Admin authentication required'});const body=await readJson(req);const row=await database.getAdmin(admin.id);if(!row?.totp_secret||!authenticator.check(String(body.otp||''),row.totp_secret))return sendJson(res,400,{error:'Invalid authenticator code'});await database.enableTotp(admin.id);sendJson(res,200,{enabled:true});}
async function adminUsers(req,res){if(!database.enabled)return sendJson(res,503,{error:'Database is not configured'});if(!adminAuth(req))return sendJson(res,401,{error:'Admin authentication required'});sendJson(res,200,{users:await database.listUsers()});}
async function adminPromos(req,res,create){if(!database.enabled||!adminAuth(req))return sendJson(res,401,{error:'Admin authentication required'});try{if(create){const b=await readJson(req);return sendJson(res,201,await database.createPromo(b.code,b.bonusId,b.usageLimit,b.expiresAt))}sendJson(res,200,{promos:await database.listPromos()})}catch(e){sendJson(res,e.code==='23505'?409:500,{error:e.code==='23505'?'Promo code already exists':'Promo operation failed'})}}
async function adminBonuses(req,res,create){if(!database.enabled||!adminAuth(req))return sendJson(res,401,{error:'Admin authentication required'});if(create){const b=await readJson(req);return sendJson(res,201,await database.createBonus(b.title,b.kind,b.amount,b.wagerMultiplier))}sendJson(res,200,{bonuses:await database.listBonuses()})}
async function adminProviders(req,res,update){if(!database.enabled||!adminAuth(req))return sendJson(res,401,{error:'Admin authentication required'});if(update){const b=await readJson(req);return sendJson(res,200,await database.setProviderControl(b.code,b.name,b.enabled,b.mode||'staging'))}sendJson(res,200,{providers:await database.listProviderControls()})}

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
