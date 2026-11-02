"use strict";
/* Onlayn loto serveri. Bütün çəkiliş, kartlar, xal və qalib serverdə təyin olunur. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = +process.env.PORT || 3000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const VERIFY_URL = process.env.VERIFY_URL || "";      // saytınızın token yoxlama ünvanı (ixtiyari)
const RESULT_URL = process.env.RESULT_URL || "";      // nəticələrin göndəriləcəyi ünvan (ixtiyari)
const API_KEY = process.env.SERVER_API_KEY || "";     // GİZLİ açar: yalnız burada, serverdə qalır
const INTERVAL = 3500, LOBBY_MS = 120000, MAX_PLAYERS = 1000, MIN_TOTAL = 3;
const BOT_NAMES = ["Elçin", "Leyla", "Tural", "Nigar", "Rauf", "Aysel", "Kamran", "Səbinə"];
const LB_FILE = path.join(__dirname, "data", "leaderboard.json");

/* ---------- köməkçilər ---------- */
const rnd = n => crypto.randomInt(n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function mkCard() {
  const rows = [0, 1, 2].map(() => shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5));
  const card = [[], [], []];
  for (let c = 0; c < 9; c++) {
    const rs = [0, 1, 2].filter(k => rows[k].includes(c));
    const lo = c ? c * 10 : 1, hi = c === 8 ? 90 : c * 10 + 9, pool = [];
    for (let v = lo; v <= hi; v++) pool.push(v);
    const pk = shuffle(pool).slice(0, rs.length).sort((a, b) => a - b);
    rs.forEach((k, i) => { card[k][c] = pk[i]; });
  }
  return card;
}
const cardHas = (card, n) => card.some(r => r.includes(n));
const best = p => Math.max(...p.marks.map(m => m.size));
const clean = s => String(s || "").replace(/[<>&"'`\u0000-\u001f]/g, "").trim().slice(0, 16);
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const all = (room, o) => room.players.forEach(p => send(p.ws, o));

/* ---------- reytinq (fayl) ---------- */
let LB = {};
try { LB = JSON.parse(fs.readFileSync(LB_FILE, "utf8")); } catch (e) { LB = {}; }
let lbTimer = null;
function saveLB() {
  clearTimeout(lbTimer);
  lbTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(LB_FILE), { recursive: true }); fs.writeFileSync(LB_FILE, JSON.stringify(LB)); } catch (e) { console.error("LB save", e.message); }
  }, 500);
}
function topLB() {
  return Object.values(LB).sort((a, b) => b.score - a.score).slice(0, 20).map(r => ({ name: r.name, score: r.score, wins: r.wins }));
}

/* ---------- otaqlar ---------- */
const rooms = new Map(), byPid = new Map();

function getRoom(code) {
  if (code) {
    for (const r of rooms.values()) if (r.code === code) return r.state === "wait" && r.players.length < MAX_PLAYERS ? r : null;
    return newRoom(code, false);
  }
  for (const r of rooms.values()) if (r.global && (r.state === "wait" || r.state === "play") && r.players.length < MAX_PLAYERS) return r;
  return newRoom("", true);
}
function newRoom(code, global) {
  const r = { id: crypto.randomUUID(), code, global: !!global, state: "wait", players: [], timers: [], order: [], pos: 0, drawn: new Set(), startAt: Date.now() + LOBBY_MS };
  rooms.set(r.id, r);
  r.lobbyTick = setInterval(() => lobbyInfo(r), 1000);
  r.startTimer = setTimeout(() => startGame(r), LOBBY_MS);
  return r;
}
function lobbyInfo(r) {
  all(r, { t: "lobby", players: r.players.map(p => p.name), left: Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)), code: r.code });
}
function addPlayer(r, ws, name, uid) {
  const p = { pid: crypto.randomUUID(), ws, name, uid, bot: false, cards: [], marks: [], score: 0 };
  r.players.push(p); byPid.set(p.pid, { r, p });
  send(ws, { t: "joined", pid: p.pid, code: r.code });
  if (r.players.length >= MAX_PLAYERS) { clearTimeout(r.startTimer); r.startAt = Date.now() + 3000; r.startTimer = setTimeout(() => startGame(r), 3000); }
  lobbyInfo(r);
  return p;
}
function startGame(r) {
  if (r.state !== "wait") return;
  clearInterval(r.lobbyTick); clearTimeout(r.startTimer);
  const humans = r.players.filter(p => !p.bot).length;
  if (!((r.global && humans >= 2) || (r.code && humans >= 2))) {
    const names = shuffle(BOT_NAMES.filter(n => !r.players.some(p => p.name === n)));
    while (r.players.length < MIN_TOTAL) r.players.push({ pid: crypto.randomUUID(), ws: null, name: names.pop(), bot: true, cards: [], marks: [], score: 0 });
  }
  r.players.forEach(p => { p.cards = [mkCard(), mkCard(), mkCard()]; p.marks = [new Set(), new Set(), new Set()]; });
  r.order = shuffle(Array.from({ length: 90 }, (_, i) => i + 1));
  r.state = "play"; r.t0 = Date.now();
  const names = r.players.map(p => p.name);
  r.players.forEach((p, i) => send(p.ws, { t: "start", you: i, players: names, cards: p.cards, interval: INTERVAL }));
  r.tickTimer = setTimeout(function loop() {
    if (r.state !== "play") return;
    tick(r);
    r.tickTimer = setTimeout(loop, INTERVAL);
  }, 2500);
}
function progress(r) { all(r, { t: "prog", c: r.players.map(best) }); }
function tick(r) {
  if (r.pos >= 90) return endGame(r, -1);
  const n = r.order[r.pos++]; r.drawn.add(n);
  all(r, { t: "ball", n, i: r.pos });
  r.players.forEach((p, idx) => {
    if (!p.bot) return;
    setTimeout(() => {   // kompüter oyunçu insan kimi bir az gecikir
      if (r.state !== "play") return;
      p.cards.forEach((c, ci) => { if (cardHas(c, n)) p.marks[ci].add(n); });
      if (p.marks.some(m => m.size === 15)) return endGame(r, idx);
      progress(r);
    }, 900 + rnd(2400));
  });
}
function mark(r, p, c, n) {
  if (r.state !== "play" || !Number.isInteger(c) || c < 0 || c > 2 || !Number.isInteger(n)) return;
  if (!cardHas(p.cards[c], n) || p.marks[c].has(n)) return;
  if (!r.drawn.has(n)) { p.score -= 5; return send(p.ws, { t: "bad", c, n, score: p.score }); }
  p.marks[c].add(n); p.score += 10;
  send(p.ws, { t: "marked", c, n, score: p.score });
  if (p.marks[c].size === 15) return endGame(r, r.players.indexOf(p));
  progress(r);
}
function endGame(r, w) {
  if (r.state !== "play") return;
  r.state = "done"; clearTimeout(r.tickTimer);
  if (w >= 0) r.players[w].score += 100 + Math.max(0, 90 - r.pos) * 2;
  const scores = r.players.map(p => p.score);
  all(r, { t: "end", w, name: w >= 0 ? r.players[w].name : "", scores, draws: r.pos, players: r.players.map(p => p.name) });
  r.players.forEach((p, i) => {
    if (p.bot) return;
    const key = p.uid || ("g:" + p.name);
    const cur = LB[key] || { name: p.name, score: 0, wins: 0 };
    cur.name = p.name; cur.score = Math.max(cur.score, p.score); if (i === w) cur.wins++;
    LB[key] = cur;
    if (RESULT_URL) {
      fetch(RESULT_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
        body: JSON.stringify({ userId: p.uid || null, name: p.name, outcome: i === w ? "win" : "lose", score: p.score, draws: r.pos, gameId: r.id, durationMs: Date.now() - r.t0 }) }).catch(() => {});
    }
  });
  saveLB();
  setTimeout(() => { r.players.forEach(p => byPid.delete(p.pid)); rooms.delete(r.id); }, 60000);
}
function leave(ws) {
  const p = ws.player; if (!p) return;
  const info = byPid.get(p.pid); if (!info) return;
  const r = info.r;
  if (r.state === "wait") {
    r.players = r.players.filter(x => x !== p); byPid.delete(p.pid);
    if (!r.players.length) { clearInterval(r.lobbyTick); clearTimeout(r.startTimer); rooms.delete(r.id); } else lobbyInfo(r);
  } else if (p.ws === ws) p.ws = null;
}

/* ---------- giriş (token yoxlaması) ---------- */
async function identify(token, name) {
  if (!VERIFY_URL) return { uid: null, name: clean(name) || "Qonaq" + (100 + rnd(900)) };
  const res = await fetch(VERIFY_URL, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("auth");
  const u = await res.json();
  return { uid: String(u.id), name: clean(u.name) || "Oyunçu" };
}

/* ---------- HTTP + WebSocket ---------- */

function attachLoto(wss) {
wss.on("connection", ws => {
  ws.alive = true; ws.msgs = 0;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("close", () => leave(ws));
  ws.on("error", () => {});
  ws.on("message", async raw => {
    if (++ws.msgs > 30) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;
    try {
      if (m.t === "join") {
        if (ws.player) return;
        const old = m.pid && byPid.get(m.pid);                       // yenidən qoşulma
        if (old && old.r.state === "play") {
          old.p.ws = ws; ws.player = old.p;
           const r = old.r, i = r.players.indexOf(old.p);
          send(ws, { t: "joined", pid: old.p.pid, code: r.code });
          send(ws, { t: "start", you: i, players: r.players.map(p => p.name), cards: old.p.cards, interval: INTERVAL });
          send(ws, { t: "sync", drawn: r.order.slice(0, r.pos), marks: old.p.marks.map(s => [...s]), score: old.p.score });
          return progress(r);
        }
        const id = await identify(m.token, m.name);
         const code = "";
         const r = getRoom(code);
         if (!r) return send(ws, { t: "err", m: "Otaq doludur və ya oyun artıq başlayıb" });
         if (ws.player) return;
         ws.player = addPlayer(r, ws, id.name, id.uid);
         if (r.state === "play") {
           const p = ws.player, i = r.players.indexOf(p);
           p.cards = [mkCard(), mkCard(), mkCard()]; p.marks = [new Set(), new Set(), new Set()];
           send(ws, { t: "start", you: i, players: r.players.map(x => x.name), cards: p.cards, interval: INTERVAL });
           send(ws, { t: "sync", drawn: r.order.slice(0, r.pos), marks: p.marks.map(s => [...s]), score: p.score });
         }
      } else if (m.t === "mark" && ws.player) {
        const info = byPid.get(ws.player.pid);
        if (info) mark(info.r, ws.player, m.c, m.n);
      }
    } catch (e) { send(ws, { t: "err", m: "Giriş alınmadı" }); }
  });
});
setInterval(() => wss.clients.forEach(ws => { ws.msgs = 0; }), 1000);
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000);
}
module.exports = { attachLoto };
