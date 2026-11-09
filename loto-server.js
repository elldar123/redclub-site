"use strict";
/* REDX Live Loto — one live studio, server-authoritative 90-ball rounds.
   Betting -> drawing -> result -> betting. All numbers, tickets, awards and
   payouts are decided on the server. */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const database = require("./database");
const { makeTicket, gridFromNumbers, ticketState, colOf } = require("./loto-cards");

const TICKET_PRICE = () => Number(process.env.LOTO_TICKET_PRICE || 1);
const BETTING_MS = () => Math.max(10000, Number(process.env.LOTO_BETTING_SECONDS || 30) * 1000);
const BALL_MS = () => Math.max(300, Number(process.env.LOTO_BALL_MS || 2000));
const RESULT_MS = () => Math.max(3000, Number(process.env.LOTO_RESULT_SECONDS || 8) * 1000);
const MAX_TICKETS = 2;
const MAX_PLAYERS = 10;
const PRIZES = { line: 2, two: 5, full: 25 };
const BOT_NAMES = ["Elçin", "Leyla", "Tural", "Nigar", "Rauf", "Aysel", "Kamran", "Səbinə", "Murad", "Günel"];
const CHAT_MAX = 60;
const BOOT_AT = Date.now();

const studio = {
  phase: "idle",
  roundId: null,
  roundCode: "—",
  roundSeq: 0,
  bettingEndsAt: 0,
  drawStartedAt: 0,
  resultEndsAt: 0,
  order: [],
  pos: 0,
  drawn: [],
  players: [],
  history: [],
  chat: [],
  timers: new Set(),
  started: false,
};

/* ---------------- utilities ---------------- */

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const money = n => Math.round(Number(n) * 100) / 100;
const clean = s => String(s || "").replace(/[<>&"'`\u0000-\u001f]/g, "").trim().slice(0, 140);
const send = (ws, o) => { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) {} } };
const each = fn => studio.players.forEach(p => { if (p.ws && p.ws.readyState === 1) fn(p); });
const broadcast = o => each(p => send(p.ws, o));
const viewerCount = () => studio.players.filter(p => !p.bot && p.ws && p.ws.readyState === 1).length;

function later(fn, ms) {
  const t = setTimeout(() => { studio.timers.delete(t); try { fn(); } catch (e) { console.error("loto timer", e); } }, ms);
  studio.timers.add(t);
  return t;
}
function clearTimers() {
  for (const t of studio.timers) clearTimeout(t);
  studio.timers.clear();
}

function patternLabel(pattern) {
  return pattern === "full" ? "TAM KART" : pattern === "two" ? "2 XƏTT" : "1 XƏTT";
}

/* ---------------- serialisation ---------------- */

function serializeTicket(t) {
  return {
    id: t.id || null,
    price: t.price,
    fundedBy: t.fundedBy || "demo",
    demo: Boolean(t.demo),
    grid: t.grid,
    marked: [...t.marked],
    awards: t.awards,
    line: t.line,
    two: t.two,
    full: t.full,
  };
}

function phasePayload() {
  return {
    t: "phase",
    phase: studio.phase,
    roundCode: studio.roundCode,
    roundId: studio.roundId,
    ticketPrice: TICKET_PRICE(),
    prizes: PRIZES,
    maxTickets: MAX_TICKETS,
    bettingEndsAt: studio.bettingEndsAt,
    drawStartedAt: studio.drawStartedAt,
    resultEndsAt: studio.resultEndsAt,
    drawn: studio.drawn.slice(),
    pos: studio.pos,
    viewers: viewerCount(),
    players: studio.players.filter(p => !p.bot).map(p => p.name),
    history: studio.history.slice(0, 8),
    serverTime: Date.now(),
  };
}

function syncPayload(p) {
  return {
    ...phasePayload(),
    t: "sync",
    pid: p.pid,
    name: p.name,
    auth: Boolean(p.userId),
    tickets: p.tickets.map(serializeTicket),
    balance: p.balance,
    bonusBalance: p.bonusBalance,
    autoBuy: Boolean(p.autoBuy),
  };
}

/* ---------------- chat ---------------- */

function addChat(name, text, system = false) {
  const m = { t: "chat", name, text, system, at: Date.now() };
  studio.chat.push(m);
  if (studio.chat.length > CHAT_MAX) studio.chat.shift();
  return m;
}
function broadcastChat(m) { broadcast(m); }

/* ---------------- tickets ---------------- */

function makeTicketRecord({ id = null, numbers, price, fundedBy = "demo", demo = false }) {
  const grid = gridFromNumbers(numbers);
  return {
    id,
    grid,
    price: Number(price) || 0,
    fundedBy,
    demo,
    numberSet: new Set(numbers || []),
    marked: new Set(),
    awards: [],
    line: false,
    two: false,
    full: false,
  };
}
function botTicket() {
  const t = makeTicket();
  return makeTicketRecord({ numbers: t.numbers, price: TICKET_PRICE(), fundedBy: "bot", demo: true });
}

function resetPlayerTickets(p) {
  p.tickets = [];
}

/* ---------------- DB round ---------------- */

async function openDbRound() {
  studio.roundId = null;
  studio.roundCode = `REDX-LIVE-${Date.now().toString().slice(-6)}`;
  if (!database.enabled) return;
  try {
    let round = await database.openLotoRound(TICKET_PRICE(), Math.round(BETTING_MS() / 1000));
    if (round && round.created_at && new Date(round.created_at).getTime() < BOOT_AT - 5000) {
      await database.closeLotoRound(round.id, []);
      round = await database.openLotoRound(TICKET_PRICE(), Math.round(BETTING_MS() / 1000));
    }
    if (round) { studio.roundId = round.id; studio.roundCode = round.round_code; }
  } catch (e) {
    console.error("loto open round", e.message);
  }
}

/* ---------------- phase control ---------------- */

async function startIdle() {
  clearTimers();
  studio.phase = "idle";
  studio.roundId = null;
  studio.roundCode = "—";
  studio.bettingEndsAt = 0;
  studio.drawStartedAt = 0;
  studio.resultEndsAt = 0;
  studio.drawn = [];
  studio.pos = 0;
  studio.players = studio.players.filter(p => !p.bot && p.ws && p.ws.readyState === 1);
  studio.players.forEach(resetPlayerTickets);
  broadcast(phasePayload());
  broadcastChat(addChat("REDX Studio", "Studio hazırdır. Oyunçu gözlənilir.", true));
}

async function startBetting() {
  if (studio.phase === "betting" || studio.phase === "drawing") return;
  clearTimers();
  studio.phase = "betting";
  studio.roundSeq++;
  studio.drawn = [];
  studio.pos = 0;
  studio.order = shuffle(Array.from({ length: 90 }, (_, i) => i + 1));
  studio.bettingEndsAt = Date.now() + BETTING_MS();
  studio.drawStartedAt = 0;
  studio.resultEndsAt = 0;
  studio.players = studio.players.filter(p => !p.bot && p.ws && p.ws.readyState === 1);
  studio.players.forEach(resetPlayerTickets);
  await openDbRound();
  broadcast(phasePayload());
  broadcastChat(addChat("REDX Studio", "Yeni raund başladı. Biletlərinizi alın!", true));
  later(beginDraw, BETTING_MS());
  // players queued for the next round
  later(async () => {
    for (const p of studio.players.slice()) {
      if (p.autoBuy && !p.bot && p.ws && p.ws.readyState === 1) {
        p.autoBuy = false;
        send(p.ws, { t: "tickets", tickets: p.tickets.map(serializeTicket), balance: p.balance, bonusBalance: p.bonusBalance, autoBuy: false });
        await purchaseTicket(p, false);
      }
    }
  }, 600);
}

function beginDraw() {
  if (studio.phase !== "betting") return;
  clearTimers();
  studio.phase = "drawing";
  studio.drawStartedAt = Date.now();

  // fill the table with demo players so the studio always feels alive
  const target = Math.min(5, Math.max(3, studio.players.length + 2));
  const used = new Set(studio.players.map(p => p.name));
  const names = shuffle(BOT_NAMES.filter(n => !used.has(n)));
  while (studio.players.length < target) {
    const name = names.pop() || `Demo ${Math.floor(Math.random() * 900 + 100)}`;
    const bot = {
      pid: "bot-" + crypto.randomUUID(),
      ws: null,
      name,
      bot: true,
      userId: null,
      tickets: [botTicket()],
      balance: null,
      bonusBalance: null,
      autoBuy: false,
    };
    studio.players.push(bot);
  }
  studio.players.filter(p => p.bot).forEach(p => { if (!p.tickets.length) p.tickets = [botTicket()]; });

  broadcast(phasePayload());
  broadcastChat(addChat("REDX Studio", "Çəkiliş başlayır. Uğurlar!", true));
  later(drawNext, 1600);
}

async function drawNext() {
  if (studio.phase !== "drawing") return;
  if (studio.pos >= 90) return endRound("drawn");

  const n = studio.order[studio.pos++];
  studio.drawn.push(n);
  broadcast({ t: "ball", n, index: studio.pos, drawn: studio.drawn.slice(), serverTime: Date.now() });

  const awards = [];
  let anyFull = false;

  for (const p of studio.players) {
    for (const t of p.tickets) {
      if (t.numberSet.has(n)) t.marked.add(n);
      const st = ticketState(t.grid, t.marked);
      if (st.line && !t.line) { t.line = true; awards.push({ p, t, pattern: "line", amount: money(t.price * PRIZES.line) }); }
      if (st.two && !t.two) { t.two = true; awards.push({ p, t, pattern: "two", amount: money(t.price * PRIZES.two) }); }
      if (st.full && !t.full) { t.full = true; awards.push({ p, t, pattern: "full", amount: money(t.price * PRIZES.full) }); anyFull = true; }
    }
  }

  for (const a of awards) {
    const { p, t, pattern, amount } = a;
    t.awards.push({ pattern, amount });
    if (!p.bot && amount > 0 && studio.roundId && t.id && !t.demo) {
      try {
        const res = await database.creditLotoWin({
          userId: p.userId,
          roundId: studio.roundId,
          ticketId: t.id,
          pattern,
          amount,
          fundedBy: t.fundedBy,
        });
        if (Number.isFinite(res.balance)) p.balance = res.balance;
        if (Number.isFinite(res.bonusBalance)) p.bonusBalance = res.bonusBalance;
        send(p.ws, { t: "award", ticketId: t.id, pattern, amount, label: patternLabel(pattern), balance: p.balance, bonusBalance: p.bonusBalance });
      } catch (e) {
        console.error("loto payout", e.message);
        send(p.ws, { t: "award", ticketId: t.id, pattern, amount, label: patternLabel(pattern), error: true });
      }
    } else if (!p.bot) {
      send(p.ws, { t: "award", ticketId: t.id, pattern, amount, label: patternLabel(pattern), balance: p.balance, bonusBalance: p.bonusBalance });
    }
    const who = p.bot ? `${p.name} (demo)` : p.name;
    const prize = amount > 0 ? ` · ₼${amount.toFixed(2)}` : "";
    broadcastChat(addChat("REDX Studio", `${who} ${patternLabel(pattern)} tamamladı${prize}`, true));
  }

  broadcast({
    t: "marks",
    drawn: studio.drawn.slice(),
    awards: awards.filter(a => !a.p.bot).map(a => ({ ticketId: a.t.id, pattern: a.pattern, amount: a.amount })),
    serverTime: Date.now(),
  });

  if (anyFull) {
    later(() => endRound("full"), 1800);
    return;
  }
  later(drawNext, BALL_MS());
}

async function endRound(reason) {
  if (studio.phase !== "drawing") return;
  clearTimers();
  studio.phase = "result";
  studio.resultEndsAt = Date.now() + RESULT_MS();

  const winners = [];
  const seen = new Set();
  for (const p of studio.players) {
    const won = p.tickets.filter(t => t.awards.length);
    if (!won.length) continue;
    const key = p.bot ? "bot:" + p.name : "user:" + (p.userId || p.pid);
    if (!seen.has(key)) {
      seen.add(key);
      winners.push({ name: p.name, bot: Boolean(p.bot), tickets: won.map(t => ({ id: t.id, awards: t.awards })) });
    }
  }
  const winnerNames = winners.map(w => w.bot ? `${w.name} (demo)` : w.name);

  if (studio.roundId) {
    try {
      const winIds = studio.players.filter(p => !p.bot).flatMap(p => p.tickets.filter(t => t.awards.length && t.id).map(t => t.id));
      await database.closeLotoTickets(studio.roundId, winIds);
      await database.closeLotoRound(studio.roundId, studio.drawn.slice());
    } catch (e) {
      console.error("loto close round", e.message);
    }
  }

  studio.history.unshift({
    code: studio.roundCode,
    drawn: studio.pos,
    numbers: studio.drawn.slice(-10),
    winners: winnerNames,
    at: Date.now(),
  });
  if (studio.history.length > 10) studio.history.pop();

  broadcast({
    t: "end",
    reason,
    roundCode: studio.roundCode,
    drawn: studio.drawn.slice(),
    winners,
    nextAt: studio.resultEndsAt,
    history: studio.history.slice(0, 8),
    serverTime: Date.now(),
  });
  broadcastChat(addChat("REDX Studio", winnerNames.length ? `Raund bitdi. Qalib: ${winnerNames.join(", ")}` : "Raund bitdi. Qalib yoxdur.", true));

  later(() => {
    if (viewerCount() > 0) startBetting();
    else startIdle();
  }, RESULT_MS());
}

/* ---------------- player actions ---------------- */

function identify(token) {
  if (!token || !process.env.ADMIN_JWT_SECRET) return null;
  try {
    const user = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    return { userId: user.id, userCode: user.externalCode, email: user.email };
  } catch (e) {
    return null;
  }
}

async function purchaseTicket(p, silent = false) {
  if (studio.phase !== "betting") {
    if (!silent) send(p.ws, { t: "err", code: "phase", m: "Bilet satışı bağlanıb. Növbəti raundu gözləyin." });
    return false;
  }
  if (p.tickets.length >= MAX_TICKETS) {
    if (!silent) send(p.ws, { t: "err", code: "limit", m: `Hər raundda maksimum ${MAX_TICKETS} bilet.` });
    return false;
  }
  if (p.buying) {
    if (!silent) send(p.ws, { t: "err", code: "busy", m: "Bilet alınır. Bir az gözləyin." });
    return false;
  }

  p.buying = true;
  try {
    return await deliverTicket(p, silent);
  } finally {
    p.buying = false;
  }
}

async function deliverTicket(p, silent) {
  const card = makeTicket();
  const price = TICKET_PRICE();

  if (database.enabled && p.userId && studio.roundId) {
    try {
      const result = await database.buyLotoTicket(p.userId, p.userCode, studio.roundId, card.numbers, price);
      if (result.insufficient) {
        if (!silent) send(p.ws, { t: "err", code: "insufficient", m: "Balans və bonus kifayət etmir.", balance: result.balance, bonusBalance: result.bonusBalance });
        return false;
      }
      p.balance = result.balance;
      p.bonusBalance = result.bonusBalance;
      const ticket = makeTicketRecord({
        id: result.ticket.id,
        numbers: result.ticket.numbers,
        price: Number(result.ticket.ticket_price),
        fundedBy: result.fundedBy,
      });
      p.tickets.push(ticket);
      send(p.ws, { t: "tickets", tickets: p.tickets.map(serializeTicket), balance: p.balance, bonusBalance: p.bonusBalance, autoBuy: Boolean(p.autoBuy) });
      send(p.ws, { t: "balance", balance: p.balance, bonusBalance: p.bonusBalance });
      broadcastChat(addChat("REDX Studio", `${p.name} bilet aldı.`, true));
      return true;
    } catch (e) {
      console.error("loto buy", e.message);
      if (!silent) send(p.ws, { t: "err", code: "db", m: "Bilet alınmadı. Yenidən cəhd edin." });
      return false;
    }
  }

  // database unavailable: free practice ticket
  const ticket = makeTicketRecord({ numbers: card.numbers, price: 0, fundedBy: "demo", demo: true });
  p.tickets.push(ticket);
  send(p.ws, { t: "tickets", tickets: p.tickets.map(serializeTicket), balance: p.balance, bonusBalance: p.bonusBalance, autoBuy: Boolean(p.autoBuy), demo: true });
  broadcastChat(addChat("REDX Studio", `${p.name} demo bilet aldı.`, true));
  return true;
}

/* ---------------- connection handling ---------------- */

function addPlayer(ws, name, auth) {
  let finalName = clean(name) || (auth?.email ? String(auth.email).split("@")[0] : `Qonaq${Math.floor(Math.random() * 900 + 100)}`);
  const used = new Set(studio.players.map(p => p.name.toLowerCase()));
  let base = finalName.slice(0, 16);
  let i = 2;
  while (used.has(finalName.toLowerCase())) { finalName = `${base}${i++}`; }
  const p = {
    pid: crypto.randomUUID(),
    ws,
    name: finalName,
    bot: false,
    userId: auth?.userId || null,
    userCode: auth?.userCode || null,
    tickets: [],
    balance: null,
    bonusBalance: null,
    autoBuy: false,
    buying: false,
    lastChat: 0,
  };
  studio.players.push(p);
  ws.player = p;
  return p;
}

function attachExisting(ws, p) {
  if (p.ws && p.ws !== ws && p.ws.readyState === 1) send(p.ws, { t: "err", code: "replaced", m: "Başqa pəncərədə qoşuldu." });
  p.ws = ws;
  ws.player = p;
}

function joinedPayload(p) {
  return {
    t: "joined",
    pid: p.pid,
    name: p.name,
    auth: Boolean(p.userId),
    balance: p.balance,
    bonusBalance: p.bonusBalance,
    tickets: p.tickets.map(serializeTicket),
    autoBuy: Boolean(p.autoBuy),
    serverTime: Date.now(),
  };
}

async function hydratePlayer(p) {
  if (!database.enabled || !p.userId) return;
  try {
    const r = await database.query("SELECT balance, bonus_balance FROM users WHERE id=$1", [p.userId]);
    if (!r.rowCount) return;
    p.balance = Number(r.rows[0].balance);
    p.bonusBalance = Number(r.rows[0].bonus_balance);
    send(p.ws, { t: "balance", balance: p.balance, bonusBalance: p.bonusBalance });
  } catch (e) {
    console.error("loto balance", e.message);
  }
}

function handleClose(ws) {
  const p = ws.player;
  if (!p) return;
  p.ws = null;
  p.autoBuy = false;
  broadcast({ t: "viewers", count: viewerCount() });
  broadcast(phasePayload());
  if (studio.phase === "betting" && !p.tickets.length) {
    later(() => {
      if (!p.ws && !p.tickets.length) {
        studio.players = studio.players.filter(x => x !== p);
        broadcast(phasePayload());
      }
    }, 45000);
  }
}

function handleJoin(ws, m) {
  if (ws.player) return;

  // reconnect with the same pid
  if (m.pid) {
    const existing = studio.players.find(p => p.pid === m.pid && !p.bot);
    if (existing) {
      attachExisting(ws, existing);
      send(ws, joinedPayload(existing));
      send(ws, syncPayload(existing));
      send(ws, { t: "viewers", count: viewerCount() });
      broadcastChat(addChat("REDX Studio", `${existing.name} yenidən qoşuldu.`, true));
      hydratePlayer(existing);
      return;
    }
  }

  const auth = identify(m.token);
  const p = addPlayer(ws, m.name, auth);
  send(ws, { ...phasePayload(), t: "hello", chat: studio.chat.slice(-40) });
  send(ws, joinedPayload(p));
  send(ws, syncPayload(p));
  send(ws, { t: "viewers", count: viewerCount() });
  broadcastChat(addChat("REDX Studio", `${p.name} studiyaya qoşuldu.`, true));
  hydratePlayer(p);

  if (studio.phase === "idle" && viewerCount() > 0) startBetting();
}

function handleMessage(ws, raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== "string") return;

  if (m.t === "join") return handleJoin(ws, m);
  if (m.t === "ping") { send(ws, { t: "pong", now: Date.now() }); return; }

  const p = ws.player;
  if (!p) return;

  if (m.t === "buy") {
    if (!p.userId) return send(ws, { t: "err", code: "auth", m: "Bilet almaq üçün hesabına daxil ol." });
    if (studio.phase === "idle") {
      p.autoBuy = true;
      send(ws, { t: "queued", m: "Növbəti raunda bilet növbəyə alındı." });
      startBetting();
      return;
    }
    if (studio.phase !== "betting") {
      p.autoBuy = true;
      send(ws, { t: "queued", m: "Növbəti raunda bilet növbəyə alındı." });
      return;
    }
    purchaseTicket(p);
    return;
  }

  if (m.t === "chat") {
    if (!p.userId) return send(ws, { t: "err", code: "auth", m: "Çat üçün hesabına daxil ol." });
    const now = Date.now();
    if (now - p.lastChat < 900) return;
    const text = clean(m.text);
    if (!text) return;
    p.lastChat = now;
    broadcastChat(addChat(p.name, text, false));
    return;
  }

  if (m.t === "leave") {
    handleClose(ws);
    return;
  }
}

/* ---------------- attach ---------------- */

function attachLoto(wss) {
  wss.on("connection", ws => {
    ws.isAlive = true;
    ws.msgCount = 0;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => handleClose(ws));
    ws.on("error", () => {});
    ws.on("message", raw => {
      if (++ws.msgCount > 40) return;
      try { handleMessage(ws, raw); } catch (e) { console.error("loto message", e); }
    });
    send(ws, { ...phasePayload(), t: "hello", chat: studio.chat.slice(-40) });
  });

  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  setInterval(() => { wss.clients.forEach(ws => { ws.msgCount = 0; }); }, 1000);

  if (!studio.started) {
    studio.started = true;
    startIdle();
  }
}

module.exports = { attachLoto, __studio: studio };
