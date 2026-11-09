"use strict";
/* REDX Live Loto — studio client.
   Renders the live studio, keeps the WebSocket in sync and never invents
   numbers or wins: every ball, mark, award and balance comes from the server. */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const money = n => `₼${Number(n || 0).toFixed(2)}`;
  const pad = n => String(n).padStart(2, "0");

  const token = () => {
    try { return localStorage.getItem("redx_token") || ""; } catch (e) { return ""; }
  };
  const storedUser = () => {
    try { return JSON.parse(localStorage.getItem("redx_user") || "null"); } catch (e) { return null; }
  };

  const user = storedUser();
  const initialName = user
    ? String(user.display_name || user.name || String(user.email || "").split("@")[0] || "Oyunçu").slice(0, 16)
    : "";

  const state = {
    ws: null,
    connected: false,
    auth: Boolean(token()),
    pid: (() => { try { return sessionStorage.getItem("redx_loto_pid") || ""; } catch (e) { return ""; } })(),
    name: initialName,
    phase: "idle",
    roundCode: "—",
    roundId: null,
    ticketPrice: 1,
    maxTickets: 2,
    prizes: { line: 2, two: 5, full: 25 },
    bettingEndsAt: 0,
    drawStartedAt: 0,
    resultEndsAt: 0,
    serverOffset: 0,
    drawn: [],
    drawnSet: new Set(),
    pos: 0,
    lastBall: null,
    shownBall: null,
    tickets: [],
    balance: user && user.balance != null ? Number(user.balance) : null,
    bonusBalance: user && user.bonus_balance != null ? Number(user.bonus_balance) : null,
    history: [],
    viewers: 0,
    autoBuy: false,
    buying: false,
    sound: true,
    lastWinners: [],
    gateDismissed: false,
    gateTimer: null,
    toastTimer: null,
    retry: 0,
    retryTimer: null,
    pingTimer: null,
  };

  /* ---------------- DOM ---------------- */

  const dom = {
    roundCode: $("#roundCode"),
    balanceValue: $("#balanceValue"),
    bonusValue: $("#bonusValue"),
    balanceChip: $("#balanceChip"),
    soundBtn: $("#soundBtn"),
    fullBtn: $("#fullBtn"),
    rulesBtn: $("#rulesBtn"),
    clock: $("#studioClock"),
    viewerCount: $("#viewerCount"),
    phaseLabel: $("#phaseLabel"),
    phaseTitle: $("#phaseTitle"),
    countdown: $("#countdown"),
    buyBtn: $("#buyBtn"),
    buyNote: $("#buyNote"),
    machineBalls: $("#machineBalls"),
    drawnBall: $("#drawnBall"),
    lastBalls: $("#lastBalls"),
    drawCount: $("#drawCount"),
    numberBoard: $("#numberBoard"),
    tickets: $("#tickets"),
    prizeNote: $("#prizeNote"),
    chatList: $("#chatList"),
    chatForm: $("#chatForm"),
    chatInput: $("#chatInput"),
    chatGate: $("#chatGate"),
    historyList: $("#historyList"),
    historyCount: $("#historyCount"),
    toast: $("#toast"),
    loginGate: $("#loginGate"),
    gateClose: $("#gateClose"),
    gateGuest: $("#gateGuest"),
    rulesDialog: $("#rulesDialog"),
    rulesClose: $("#rulesClose"),
    rulesOk: $("#rulesOk"),
    stageScene: $("#stageScene"),
  };

  /* ---------------- sound ---------------- */

  let audioCtx = null;
  try { state.sound = localStorage.getItem("redx_loto_sound") !== "off"; } catch (e) {}

  function tone(freq, duration, type, volume, delay) {
    if (!state.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const t0 = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume || 0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.03);
    } catch (e) {}
  }
  const soundBall = () => tone(760, 0.09, "triangle", 0.05);
  const soundBuy = () => { tone(520, 0.1, "sine", 0.06); tone(780, 0.12, "sine", 0.05, 0.08); };
  const soundWin = () => { tone(523, 0.16, "sine", 0.07); tone(659, 0.16, "sine", 0.07, 0.12); tone(784, 0.28, "sine", 0.08, 0.24); };
  const soundEnd = () => { tone(392, 0.18, "sine", 0.05); tone(523, 0.24, "sine", 0.05, 0.16); };

  function paintSound() {
    if (dom.soundBtn) {
      dom.soundBtn.textContent = state.sound ? "🔊" : "🔇";
      dom.soundBtn.setAttribute("aria-label", state.sound ? "Səsi bağla" : "Səsi aç");
    }
  }

  /* ---------------- toast ---------------- */

  function showToast(text, ms) {
    if (!dom.toast) return;
    dom.toast.textContent = text;
    dom.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => dom.toast.classList.remove("show"), ms || 2700);
  }

  /* ---------------- websocket ---------------- */

  function send(payload) {
    const ws = state.ws;
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(payload)); } catch (e) {}
    }
  }

  function connect() {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
    if (!("WebSocket" in window)) { showToast("Brauzer canlı rejimi dəstəkləmir"); return; }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    let ws;
    try { ws = new WebSocket(`${proto}//${location.host}`); } catch (e) { scheduleReconnect(); return; }
    state.ws = ws;

    ws.onopen = () => {
      state.retry = 0;
      state.connected = true;
      send({ t: "join", name: state.name || initialName, token: token() || undefined, pid: state.pid || undefined });
      clearInterval(state.pingTimer);
      state.pingTimer = setInterval(() => send({ t: "ping" }), 20000);
    };

    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m.t !== "string") return;
      handle(m);
    };

    ws.onclose = () => {
      state.connected = false;
      state.buying = false;
      clearInterval(state.pingTimer);
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function scheduleReconnect() {
    if (state.retryTimer) return;
    const delay = Math.min(12000, 1200 * Math.pow(1.6, state.retry++));
    state.retryTimer = setTimeout(() => { state.retryTimer = null; connect(); }, delay);
  }

  /* ---------------- server messages ---------------- */

  function handle(m) {
    switch (m.t) {
      case "hello":
        applyPhase(m);
        if (Array.isArray(m.chat)) renderChat(m.chat, true);
        maybeGate();
        break;
      case "phase":
        applyPhase(m);
        break;
      case "joined":
        state.pid = m.pid || state.pid;
        try { if (state.pid) sessionStorage.setItem("redx_loto_pid", state.pid); } catch (e) {}
        state.name = m.name || state.name;
        state.auth = Boolean(m.auth);
        if (m.balance != null) state.balance = Number(m.balance);
        if (m.bonusBalance != null) state.bonusBalance = Number(m.bonusBalance);
        if (Array.isArray(m.tickets)) state.tickets = m.tickets;
        state.autoBuy = Boolean(m.autoBuy);
        paintAuth();
        renderBalance();
        renderTickets();
        renderPhase();
        maybeGate();
        break;
      case "sync":
        applyPhase(m);
        state.pid = m.pid || state.pid;
        try { if (state.pid) sessionStorage.setItem("redx_loto_pid", state.pid); } catch (e) {}
        state.name = m.name || state.name;
        state.auth = Boolean(m.auth);
        if (m.balance != null) state.balance = Number(m.balance);
        if (m.bonusBalance != null) state.bonusBalance = Number(m.bonusBalance);
        if (Array.isArray(m.tickets)) state.tickets = m.tickets;
        state.autoBuy = Boolean(m.autoBuy);
        paintAuth();
        renderAll();
        break;
      case "tickets":
        if (Array.isArray(m.tickets)) state.tickets = m.tickets;
        if (m.balance != null) state.balance = Number(m.balance);
        if (m.bonusBalance != null) state.bonusBalance = Number(m.bonusBalance);
        state.autoBuy = Boolean(m.autoBuy);
        state.buying = false;
        renderBalance();
        renderTickets();
        renderPhase();
        if (m.tickets && m.tickets.length) soundBuy();
        break;
      case "balance":
        if (m.balance != null) state.balance = Number(m.balance);
        if (m.bonusBalance != null) state.bonusBalance = Number(m.bonusBalance);
        renderBalance();
        break;
      case "ball":
        onBall(m);
        break;
      case "marks":
        if (Array.isArray(m.drawn)) setDrawn(m.drawn);
        renderBoard();
        renderTickets();
        renderPhase();
        break;
      case "award":
        onAward(m);
        break;
      case "end":
        onEnd(m);
        break;
      case "queued":
        state.autoBuy = true;
        state.buying = false;
        showToast(m.m || "Növbəti raunda bilet növbəyə alındı");
        renderPhase();
        break;
      case "err":
        state.buying = false;
        if (m.balance != null) state.balance = Number(m.balance);
        if (m.bonusBalance != null) state.bonusBalance = Number(m.bonusBalance);
        if (m.code === "auth") { showGate(); }
        if (m.code === "limit" || m.code === "phase" || m.code === "insufficient") {
          state.autoBuy = false;
          renderPhase();
        }
        renderBalance();
        showToast(m.m || "Xəta baş verdi");
        break;
      case "viewers":
        state.viewers = Number(m.count || 0);
        paintViewers();
        break;
      case "chat":
        appendChat(m);
        break;
      case "pong":
        break;
      default:
        break;
    }
  }

  function applyPhase(m) {
    const prevRoundId = state.roundId;
    if (typeof m.phase === "string") state.phase = m.phase;
    if (m.roundCode) state.roundCode = m.roundCode;
    if (m.roundId != null) state.roundId = m.roundId;
    if (m.ticketPrice != null) state.ticketPrice = Number(m.ticketPrice);
    if (m.prizes) state.prizes = m.prizes;
    if (m.maxTickets != null) state.maxTickets = Number(m.maxTickets);
    if (m.bettingEndsAt != null) state.bettingEndsAt = Number(m.bettingEndsAt);
    if (m.drawStartedAt != null) state.drawStartedAt = Number(m.drawStartedAt);
    if (m.resultEndsAt != null) state.resultEndsAt = Number(m.resultEndsAt);
    if (m.serverTime != null) state.serverOffset = Number(m.serverTime) - Date.now();
    if (m.phase !== "betting") state.buying = false;
    if (Array.isArray(m.drawn)) setDrawn(m.drawn);
    if (m.pos != null) state.pos = Number(m.pos);
    if (Array.isArray(m.history)) state.history = m.history;
    if (m.viewers != null) state.viewers = Number(m.viewers);
    if (
      state.phase === "betting" &&
      prevRoundId != null &&
      m.roundId != null &&
      String(m.roundId) !== String(prevRoundId)
    ) {
      state.tickets = [];
      state.lastWinners = [];
      state.lastBall = null;
      renderTickets();
    }
    renderPhase();
    renderBoard();
    renderHistory();
    paintViewers();
  }

  function setDrawn(list) {
    state.drawn = (list || []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 90);
    state.drawnSet = new Set(state.drawn);
    if (state.drawn.length) state.pos = Math.max(state.pos, state.drawn.length);
  }

  function onBall(m) {
    const n = Number(m.n);
    if (!Number.isInteger(n) || n < 1 || n > 90) return;
    state.lastBall = n;
    if (!state.drawnSet.has(n)) state.drawn.push(n);
    state.drawnSet.add(n);
    state.pos = Number(m.index || state.drawn.length);
    soundBall();
    renderBoard();
    renderTickets();
    renderPhase();
    pulse(n);
  }

  function onAward(m) {
    const label = m.label || (m.pattern === "full" ? "TAM KART" : m.pattern === "two" ? "2 XƏTT" : "1 XƏTT");
    if (m.balance != null) state.balance = Number(m.balance);
    if (m.bonusBalance != null) state.bonusBalance = Number(m.bonusBalance);
    renderBalance();
    if (m.error) {
      showToast(`${label} qeydə alındı, balans yenilənəcək`);
      return;
    }
    soundWin();
    celebrate();
    const moneyText = Number(m.amount || 0) > 0 ? ` · ${money(m.amount)}` : "";
    showToast(`Qazandın! ${label}${moneyText}`, 3600);
    renderTickets();
  }

  function onEnd(m) {
    state.phase = "result";
    if (m.resultEndsAt != null) state.resultEndsAt = Number(m.resultEndsAt);
    if (m.nextAt != null) state.resultEndsAt = Number(m.nextAt);
    if (m.roundCode) state.roundCode = m.roundCode;
    if (Array.isArray(m.drawn)) setDrawn(m.drawn);
    if (Array.isArray(m.history)) state.history = m.history;
    state.lastWinners = Array.isArray(m.winners) ? m.winners : [];
    soundEnd();
    renderPhase();
    renderBoard();
    renderHistory();
    renderTickets();
  }

  /* ---------------- render: top / phase ---------------- */

  function renderBalance() {
    if (dom.balanceValue) dom.balanceValue.textContent = state.auth ? money(state.balance) : "₼0.00";
    if (dom.bonusValue) {
      if (!state.auth) dom.bonusValue.textContent = "giriş et";
      else dom.bonusValue.textContent = `bonus ${money(state.bonusBalance)}`;
    }
  }

  function paintAuth() {
    if (dom.chatGate) dom.chatGate.hidden = state.auth;
    if (dom.chatInput) {
      dom.chatInput.disabled = false;
      dom.chatInput.placeholder = state.auth ? "Mesaj yaz..." : "Çat üçün giriş et";
    }
    renderBalance();
  }

  function paintViewers() {
    if (dom.viewerCount) dom.viewerCount.textContent = String(state.viewers || 0);
  }

  function renderPhase() {
    if (dom.roundCode) dom.roundCode.textContent = state.roundCode || "—";
    if (dom.prizeNote) {
      dom.prizeNote.textContent = `Bilet qiyməti ${money(state.ticketPrice)} · hər raundda maks. ${state.maxTickets} bilet`;
    }
    paintViewers();
    renderBuyButton();
    tick();
  }

  function winnersText() {
    if (!state.lastWinners.length) return "";
    return state.lastWinners
      .map(w => {
        const name = w.bot ? `${w.name} (demo)` : w.name;
        const total = (w.tickets || []).reduce(
          (sum, t) => sum + (t.awards || []).reduce((s, a) => s + Number(a.amount || 0), 0),
          0
        );
        return total > 0 ? `${name} ${money(total)}` : name;
      })
      .join(", ");
  }

  function renderBuyButton() {
    if (!dom.buyBtn) return;
    let label = `Bilet al · ${money(state.ticketPrice)}`;
    let note = "Auto daub aktivdir · qalibiyyət dərhal balansa";
    let disabled = false;

    if (!state.auth) {
      label = "Giriş et · bilet al";
      note = "Bilet və çat üçün hesabına daxil ol";
    } else if (state.buying) {
      label = "Bilet alınır...";
      note = "Server bileti təsdiqləyir";
      disabled = true;
    } else if (state.autoBuy) {
      label = "Növbəti raund üçün növbədə ✓";
      note = "Yeni raund açılanda bilet avtomatik alınacaq";
      disabled = true;
    } else if (state.tickets.length >= state.maxTickets) {
      label = "Bilet limiti dolub";
      note = `Bu raundda maksimum ${state.maxTickets} bilet`;
      disabled = true;
    } else if (state.phase === "drawing") {
      label = `Növbəti raund · ${money(state.ticketPrice)}`;
      note = "Çəkiliş gedir · bilet növbəti raunda alınacaq";
    } else if (state.phase === "result") {
      label = `Növbəti raund · ${money(state.ticketPrice)}`;
      note = "Nəticə açıqlanır · bilet növbəti raunda alınacaq";
    } else if (state.phase === "idle") {
      label = `Oyuna qoşul · ${money(state.ticketPrice)}`;
      note = "Studiya yeni oyunçunu gözləyir";
    }

    if (state.phase === "result" && state.lastWinners.length) {
      note = `Qalib: ${winnersText()}`;
    }

    dom.buyBtn.textContent = label;
    dom.buyBtn.disabled = disabled;
    if (dom.buyNote) dom.buyNote.textContent = note;
  }

  function tick() {
    const now = Date.now() + (state.serverOffset || 0);
    let label = "STUDIYA HAZIR";
    let title = "Oyunçu gözlənilir";
    let cd = "--:--";
    let hot = false;

    if (state.phase === "betting") {
      const left = Math.max(0, state.bettingEndsAt - now);
      label = "BİLET SATIŞI";
      title = "Biletlərinizi alın";
      cd = `${pad(Math.floor(left / 60000))}:${pad(Math.ceil((left % 60000) / 1000))}`;
      if (left <= 5000) hot = true;
    } else if (state.phase === "drawing") {
      label = "CANLI ÇƏKİLİŞ";
      title = "Toplar çəkilir";
      cd = `${pad(state.pos)} / 90`;
      hot = true;
    } else if (state.phase === "result") {
      const left = Math.max(0, state.resultEndsAt - now);
      label = "RAUND NƏTİCƏSİ";
      title = state.lastWinners.length ? "Qaliblər elan olundu" : "Raund bitdi";
      cd = `${pad(Math.floor(left / 60000))}:${pad(Math.ceil((left % 60000) / 1000))}`;
    }

    if (dom.phaseLabel) dom.phaseLabel.textContent = label;
    if (dom.phaseTitle) dom.phaseTitle.textContent = title;
    if (dom.countdown) {
      const text = hot && state.phase === "drawing" ? cd : cd;
      if (dom.countdown.textContent !== text) dom.countdown.textContent = text;
      dom.countdown.classList.toggle("is-hot", hot && state.phase === "betting" && state.bettingEndsAt - now <= 5000);
    }
    if (dom.stageScene) dom.stageScene.dataset.phase = state.phase;

    // title countdown while betting
    if (state.phase === "betting") {
      const secs = Math.max(0, Math.ceil((state.bettingEndsAt - now) / 1000));
      document.title = `(${secs}s) REDX Live Loto`;
    } else {
      document.title = "REDX Live Loto — Canlı studiya";
    }
  }

  /* ---------------- render: board / balls ---------------- */

  const boardCells = new Map();

  function buildBoard() {
    if (!dom.numberBoard) return;
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= 90; n++) {
      const cell = document.createElement("span");
      cell.textContent = String(n);
      cell.dataset.n = String(n);
      boardCells.set(n, cell);
      frag.appendChild(cell);
    }
    dom.numberBoard.appendChild(frag);
  }

  function renderBoard() {
    const latest = state.drawn.length ? state.drawn[state.drawn.length - 1] : null;
    for (let n = 1; n <= 90; n++) {
      const cell = boardCells.get(n);
      if (!cell) continue;
      const called = state.drawnSet.has(n);
      cell.classList.toggle("called", called);
      cell.classList.toggle("latest", called && n === latest);
    }
    if (dom.drawCount) dom.drawCount.textContent = String(state.drawn.length);
    if (dom.lastBalls) {
      const balls = state.drawn.slice(-8).reverse();
      dom.lastBalls.replaceChildren();
      if (!balls.length) {
        const empty = document.createElement("span");
        empty.className = "empty-ball";
        empty.textContent = "—";
        dom.lastBalls.appendChild(empty);
      } else {
        balls.forEach((n, i) => {
          const b = document.createElement("span");
          b.className = "ball";
          b.textContent = String(n);
          if (i === 0) b.style.outline = "2px solid rgba(255, 223, 158, .55)";
          b.style.animationDelay = `${i * 0.02}s`;
          dom.lastBalls.appendChild(b);
        });
      }
    }
    refreshDrawnBall();
  }

  function refreshDrawnBall() {
    if (!dom.drawnBall) return;
    const latest = state.drawn.length ? state.drawn[state.drawn.length - 1] : null;
    const show = state.phase === "drawing" || state.phase === "result";
    const value = show && latest ? String(latest) : "?";
    if (dom.drawnBall.textContent !== value) {
      dom.drawnBall.textContent = value;
      if (value !== "?") {
        dom.drawnBall.classList.remove("pop");
        void dom.drawnBall.offsetWidth;
        dom.drawnBall.classList.add("pop");
      }
    }
    dom.drawnBall.classList.toggle("hot", show && state.phase === "drawing");
  }

  function pulse(n) {
    const cell = boardCells.get(n);
    if (!cell) return;
    cell.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.22)", offset: 0.45 },
        { transform: "scale(1.08)", offset: 0.7 },
        { transform: "scale(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.8,.3,1.2)" }
    );
    if (dom.drawnBall) {
      dom.drawnBall.animate(
        [
          { transform: "scale(.6)", opacity: 0.2 },
          { transform: "scale(1.1)", opacity: 1, offset: 0.6 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 480, easing: "cubic-bezier(.2,.9,.3,1.25)" }
      );
    }
  }

  function buildMachineBalls() {
    if (!dom.machineBalls) return;
    const positions = [
      [10, 14], [38, 8], [64, 16], [16, 38], [42, 34], [68, 40],
      [8, 62], [34, 60], [60, 62], [24, 78], [50, 80], [72, 76],
    ];
    const numbers = [4, 17, 29, 41, 55, 63, 72, 81, 90, 12, 48, 76];
    positions.forEach((p, i) => {
      const ball = document.createElement("span");
      ball.style.setProperty("--x", `${p[0]}%`);
      ball.style.setProperty("--y", `${p[1]}%`);
      ball.style.setProperty("--dur", `${2.2 + (i % 5) * 0.35}s`);
      ball.style.setProperty("--delay", `${(i % 6) * -0.32}s`);
      ball.style.setProperty("--dx", `${(i % 2 ? 1 : -1) * (2 + (i % 3))}px`);
      ball.style.setProperty("--dy", `${-2 - (i % 4)}px`);
      ball.textContent = String(numbers[i]);
      if (i % 3 === 0) ball.classList.add("gold");
      else if (i % 5 === 0) ball.classList.add("red");
      dom.machineBalls.appendChild(ball);
    });
  }

  /* ---------------- render: tickets ---------------- */

  function ticketStats(t) {
    const marked = new Set([...(t.marked || []).map(Number), ...state.drawn]);
    const grid = Array.isArray(t.grid) ? t.grid : [];
    const rows = grid.map(row => {
      const nums = (row || []).filter(n => n !== null && n !== undefined);
      return nums.length > 0 && nums.every(n => marked.has(Number(n)));
    });
    const all = grid.flat().filter(n => n !== null && n !== undefined);
    const markedTotal = all.filter(n => marked.has(Number(n))).length;
    return {
      rows,
      marked,
      line: rows.some(Boolean) || Boolean(t.line),
      two: rows.filter(Boolean).length >= 2 || Boolean(t.two),
      full: (all.length === 15 && markedTotal === 15) || Boolean(t.full),
      markedTotal,
      total: all.length,
    };
  }

  function renderTickets() {
    if (!dom.tickets) return;
    if (!state.tickets.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const b = document.createElement("b");
      b.textContent = state.auth ? "Hələ biletin yoxdur." : "Qonaq rejimindəsən.";
      const span = document.createElement("span");
      span.textContent = state.auth
        ? "“Bilet al” düyməsini bas və 15 rəqəmli kartını al."
        : "Bilet almaq üçün hesabına daxil ol və canlı çəkilişə qoşul.";
      empty.append(b, span);
      dom.tickets.replaceChildren(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    state.tickets.forEach((t, index) => {
      const stats = ticketStats(t);
      const card = document.createElement("article");
      card.className = "ticket";

      const head = document.createElement("div");
      head.className = "ticket-head";
      const id = document.createElement("span");
      id.textContent = `REDX · ${t.id ? "#" + t.id : "DEMO " + (index + 1)}`;
      const price = document.createElement("em");
      const source = t.fundedBy === "bonus" ? "BONUS" : t.fundedBy === "cash" ? "CASH" : "DEMO";
      price.textContent = `${money(t.price)} · ${source}`;
      head.append(id, price);

      const grid = document.createElement("div");
      grid.className = "ticket-grid";
      (t.grid || []).forEach(row => {
        (row || []).forEach(n => {
          const cell = document.createElement("span");
          if (n === null || n === undefined) {
            cell.className = "cell empty";
          } else {
            cell.className = "cell num";
            cell.textContent = String(n);
            if (stats.marked.has(Number(n))) cell.classList.add("marked");
            if (Number(n) === Number(state.lastBall)) cell.classList.add("hit");
          }
          grid.appendChild(cell);
        });
      });

      const foot = document.createElement("div");
      foot.className = "ticket-foot";
      [["1 XƏTT", stats.line], ["2 XƏTT", stats.two], ["TAM KART", stats.full]].forEach(([text, on]) => {
        const badge = document.createElement("span");
        badge.className = "badge" + (on ? " on" : "");
        badge.textContent = text;
        foot.appendChild(badge);
      });

      const won = (t.awards || []).reduce((sum, a) => sum + Number(a.amount || 0), 0);
      if (won > 0) {
        const total = document.createElement("span");
        total.className = "ticket-won";
        total.textContent = `QAZANDI ${money(won)}`;
        foot.appendChild(total);
      }

      card.append(head, grid, foot);
      frag.appendChild(card);
    });
    dom.tickets.replaceChildren(frag);
  }

  /* ---------------- render: chat ---------------- */

  function chatNode(m) {
    const row = document.createElement("div");
    row.className = "chat-msg" + (m.system ? " system" : "") + (m.name === state.name && !m.system ? " me" : "");
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = m.system ? "R" : String(m.name || "?").charAt(0).toUpperCase();
    const body = document.createElement("div");
    body.className = "body";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = m.system ? "REDX Studio" : m.name || "Oyunçu";
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = m.text || "";
    body.append(name, text);
    row.append(avatar, body);
    return row;
  }

  function appendChat(m) {
    if (!dom.chatList) return;
    const nearBottom = dom.chatList.scrollHeight - dom.chatList.scrollTop - dom.chatList.clientHeight < 60;
    dom.chatList.appendChild(chatNode(m));
    while (dom.chatList.children.length > 80) dom.chatList.removeChild(dom.chatList.firstElementChild);
    if (nearBottom) dom.chatList.scrollTop = dom.chatList.scrollHeight;
  }

  function renderChat(list, reset) {
    if (!dom.chatList) return;
    if (reset) dom.chatList.replaceChildren();
    (list || []).forEach(m => dom.chatList.appendChild(chatNode(m)));
    while (dom.chatList.children.length > 80) dom.chatList.removeChild(dom.chatList.firstElementChild);
    dom.chatList.scrollTop = dom.chatList.scrollHeight;
  }

  /* ---------------- render: history ---------------- */

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) { return "--:--"; }
  }

  function renderHistory() {
    if (!dom.historyList) return;
    if (dom.historyCount) dom.historyCount.textContent = String(state.history.length);
    if (!state.history.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state small";
      const span = document.createElement("span");
      span.textContent = "Hələ nəticə yoxdur. İlk raund başlayır.";
      empty.appendChild(span);
      dom.historyList.replaceChildren(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    state.history.forEach(h => {
      const row = document.createElement("div");
      row.className = "history-row";
      const code = document.createElement("span");
      code.className = "code";
      code.textContent = h.code || "REDX";
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = formatTime(h.at);
      const meta = document.createElement("span");
      meta.className = "meta";
      const count = document.createElement("b");
      count.textContent = `${h.drawn || 0} top`;
      const winners = document.createElement("span");
      winners.className = "winner";
      winners.textContent = (h.winners && h.winners.length) ? h.winners.join(", ") : "Qalib yoxdur";
      meta.append(count, winners);
      row.append(code, time, meta);
      frag.appendChild(row);
    });
    dom.historyList.replaceChildren(frag);
  }

  /* ---------------- effects ---------------- */

  function celebrate() {
    try {
      const layer = document.createElement("div");
      layer.className = "fx-layer";
      document.body.appendChild(layer);
      const colors = ["#f4c15d", "#ffdf9e", "#e11d2e", "#ff7d8a", "#fff6d0"];
      for (let i = 0; i < 28; i++) {
        const bit = document.createElement("i");
        const size = 5 + Math.random() * 8;
        bit.style.cssText = `left:${50 + (Math.random() - 0.5) * 34}%;top:${42 + Math.random() * 14}%;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 0.45)}px;background:${colors[i % colors.length]};border-radius:${Math.random() > 0.4 ? "50%" : "2px"};position:absolute;pointer-events:none;`;
        layer.appendChild(bit);
        bit.animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            {
              transform: `translate(${(Math.random() - 0.5) * 340}px, ${80 + Math.random() * 220}px) rotate(${Math.random() * 540 - 270}deg)`,
              opacity: 0,
            },
          ],
          { duration: 1300 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.4,1)" }
        );
      }
      setTimeout(() => layer.remove(), 2400);
    } catch (e) {}
  }

  /* ---------------- auth gate ---------------- */

  function showGate() {
    if (!dom.loginGate || state.auth) return;
    dom.loginGate.hidden = false;
  }

  function hideGate() {
    if (dom.loginGate) dom.loginGate.hidden = true;
  }

  function maybeGate() {
    if (state.auth || state.gateDismissed) return;
    let seen = false;
    try { seen = sessionStorage.getItem("redx_loto_gate_seen") === "1"; } catch (e) {}
    if (seen) return;
    clearTimeout(state.gateTimer);
    state.gateTimer = setTimeout(() => {
      if (!state.auth) showGate();
    }, 2200);
  }

  function dismissGate() {
    state.gateDismissed = true;
    try { sessionStorage.setItem("redx_loto_gate_seen", "1"); } catch (e) {}
    hideGate();
  }

  /* ---------------- actions ---------------- */

  function buy() {
    if (!state.auth) {
      showGate();
      return;
    }
    if (!state.connected) {
      showToast("Serverə qoşulma yoxdur. Bir az sonra yenidən cəhd et.");
      return;
    }
    if (state.autoBuy) {
      showToast("Bilet növbəti raund üçün artıq növbədədir");
      return;
    }
    if (state.buying) return;
    if (state.tickets.length >= state.maxTickets) {
      showToast(`Hər raundda maksimum ${state.maxTickets} bilet`);
      return;
    }
    state.buying = true;
    renderPhase();
    if (state.phase !== "betting") {
      state.autoBuy = true;
      send({ t: "buy" });
      showToast("Bilet növbəti raund üçün növbəyə alındı");
      return;
    }
    send({ t: "buy" });
  }

  function renderAll() {
    paintAuth();
    renderPhase();
    renderBoard();
    renderTickets();
    renderHistory();
    paintViewers();
  }

  /* ---------------- events ---------------- */

  buildBoard();
  buildMachineBalls();
  paintSound();
  paintAuth();
  renderPhase();
  renderBoard();
  renderHistory();
  renderTickets();
  connect();

  if (dom.buyBtn) dom.buyBtn.addEventListener("click", buy);

  if (dom.soundBtn) {
    dom.soundBtn.addEventListener("click", () => {
      state.sound = !state.sound;
      try { localStorage.setItem("redx_loto_sound", state.sound ? "on" : "off"); } catch (e) {}
      paintSound();
      if (state.sound) tone(660, 0.1, "sine", 0.05);
    });
  }

  if (dom.fullBtn) {
    dom.fullBtn.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (e) {
        showToast("Tam ekran bu brauzerdə mümkün deyil");
      }
    });
  }

  if (dom.rulesBtn && dom.rulesDialog) {
    dom.rulesBtn.addEventListener("click", () => {
      try { dom.rulesDialog.showModal(); } catch (e) { dom.rulesDialog.setAttribute("open", ""); }
    });
  }
  [dom.rulesClose, dom.rulesOk].forEach(btn => {
    if (btn && dom.rulesDialog) btn.addEventListener("click", () => { try { dom.rulesDialog.close(); } catch (e) {} });
  });
  if (dom.rulesDialog) {
    dom.rulesDialog.addEventListener("click", e => {
      if (e.target === dom.rulesDialog) { try { dom.rulesDialog.close(); } catch (err) {} }
    });
  }

  if (dom.gateClose) dom.gateClose.addEventListener("click", dismissGate);
  if (dom.gateGuest) dom.gateGuest.addEventListener("click", dismissGate);
  if (dom.loginGate) {
    dom.loginGate.addEventListener("click", e => { if (e.target === dom.loginGate) dismissGate(); });
  }

  if (dom.chatForm) {
    dom.chatForm.addEventListener("submit", e => {
      e.preventDefault();
      if (!state.auth) { showGate(); return; }
      const text = String(dom.chatInput.value || "").trim();
      if (!text) return;
      send({ t: "chat", text });
      dom.chatInput.value = "";
    });
  }

  window.addEventListener("pagehide", () => {
    clearInterval(state.pingTimer);
    if (state.ws) { try { state.ws.close(); } catch (e) {} }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.ws && state.ws.readyState > 1) {
      connect();
    }
  });

  setInterval(tick, 250);
  setInterval(() => {
    if (!dom.clock) return;
    const d = new Date(Date.now() + (state.serverOffset || 0));
    dom.clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }, 1000);
})();
