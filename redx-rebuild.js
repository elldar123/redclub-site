/* REDX — premium casino front-end */
const state = { games: [], shown: 30, featured: 0, auth: 'login', filter: 'all', query: '' };
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const grid = $('#gameGrid');
const toast = $('#toast');
let toastTimer = null;

const PROVIDERS = {
  pragmatic: 'Pragmatic Play',
  amusnet: 'Amusnet',
  pgsoft: 'PG Soft',
  amatic: 'Amatic'
};

const AUTH_TEXT = {
  az: {
    loginTitle: 'Giriş', regTitle: 'Qeydiyyat',
    loginLead: 'Email və şifrə ilə hesabına daxil ol',
    regLead: 'Email və şifrə ilə qeydiyyatdan keç',
    loginSubmit: 'Daxil ol →', regSubmit: 'Hesab yarat →',
    toReg: 'Hesabın yoxdur? Qeydiyyat', toLogin: 'Artıq hesabın var? Giriş et'
  },
  tr: {
    loginTitle: 'Giriş', regTitle: 'Kayıt ol',
    loginLead: 'Email ve şifre ile hesabına giriş yap',
    regLead: 'Email ve şifre ile kayıt ol',
    loginSubmit: 'Giriş yap →', regSubmit: 'Hesap oluştur →',
    toReg: 'Hesabın yok mu? Kayıt ol', toLogin: 'Zaten hesabın var mı? Giriş yap'
  },
  kk: {
    loginTitle: 'Кіру', regTitle: 'Тіркелу',
    loginLead: 'Email және құпиясөз арқылы аккаунтқа кіріңіз',
    regLead: 'Email және құпиясөз арқылы тіркелу',
    loginSubmit: 'Кіру →', regSubmit: 'Аккаунт құру →',
    toReg: 'Аккаунтың жоқ па? Тіркелу', toLogin: 'Аккаунтың бар ма? Кіру'
  },
  ru: {
    loginTitle: 'Войти', regTitle: 'Регистрация',
    loginLead: 'Войдите в аккаунт по email и паролю',
    regLead: 'Регистрация по email и паролю',
    loginSubmit: 'Войти →', regSubmit: 'Создать аккаунт →',
    toReg: 'Нет аккаунта? Регистрация', toLogin: 'Уже есть аккаунт? Войти'
  },
  uz: {
    loginTitle: 'Kirish', regTitle: "Ro'yxatdan o'tish",
    loginLead: 'Email va parol bilan hisobingizga kiring',
    regLead: "Email va parol bilan ro'yxatdan o'ting",
    loginSubmit: 'Kirish →', regSubmit: 'Hisob yaratish →',
    toReg: "Hisobingiz yo'qmi? Ro'yxatdan o'tish", toLogin: 'Hisobingiz bormi? Kirish'
  },
  en: {
    loginTitle: 'Log in', regTitle: 'Create account',
    loginLead: 'Log in to your account with email and password',
    regLead: 'Register with email and password',
    loginSubmit: 'Log in →', regSubmit: 'Create account →',
    toReg: 'No account? Register', toLogin: 'Already have an account? Log in'
  }
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function providerLabel(p) {
  return PROVIDERS[p] || (p ? String(p) : 'REDX');
}

function artUrl(g) {
  return g.iconurl3 || g.iconurl2 || g.iconurl1 || g.iconurl || '';
}

function fallbackArt(g) {
  const primary = artUrl(g);
  return [g.iconurl2, g.iconurl1, g.iconurl].find(u => u && u !== primary) || '';
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ---------------- catalog ---------------- */

function filteredGames() {
  let list = state.games;
  if (state.filter !== 'all') list = list.filter(g => String(g.provider || '') === state.filter);
  const q = state.query.trim().toLowerCase();
  if (q) list = list.filter(g => String(g.name || '').toLowerCase().includes(q));
  return list;
}

function render() {
  const list = filteredGames();
  const items = list.slice(0, state.shown);

  if (!items.length) {
    grid.innerHTML = '<div class="loading">Oyun tapılmadı. Başqa axtarış sınayın.</div>';
    $('#loadMore').style.display = 'none';
    return;
  }

  grid.innerHTML = items.map((g, i) => {
    const art = artUrl(g);
    const fallback = fallbackArt(g);
    return `
    <article class="game-card" style="--i:${i % 12}" data-provider="${esc(g.provider || 'pragmatic')}">
      <div class="game-visual" style="--art:url(&quot;${esc(art)}&quot;)">
        <img class="game-art-img" loading="lazy" src="${esc(art)}" alt="${esc(g.name)}"${fallback ? ` data-fallback="${esc(fallback)}" onerror="this.onerror=null;this.src=this.dataset.fallback;if(this.parentNode){this.parentNode.style.setProperty('--art','url(&quot;'+this.dataset.fallback+'&quot;)')}"` : ''}>
        <span class="demo-chip">DEMO</span>
      </div>
      <div class="game-info">
        <div class="game-meta">
          <h3>${esc(g.name)}</h3>
          <span>${providerLabel(g.provider)}</span>
        </div>
        <button class="play-btn" data-id="${esc(g.gameid)}" data-provider="${esc(g.provider || 'pragmatic')}" aria-label="${esc(g.name)} oyna">▶</button>
      </div>
    </article>
  `;
  }).join('');

  $$('.play-btn', grid).forEach(b => {
    b.onclick = e => { e.stopPropagation(); launch(b); };
  });
  $$('.game-card', grid).forEach(card => {
    card.onclick = () => {
      const b = card.querySelector('.play-btn');
      if (b) launch(b);
    };
  });
  $('#loadMore').style.display = state.shown < list.length ? 'block' : 'none';
}

async function launch(btn) {
  showToast('Oyun açılır...');
  try {
    const r = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gameId: btn.dataset.id,
        provider: btn.dataset.provider,
        userId: 'demo001'
      })
    });
    const d = await r.json();
    if (d.url) {
      $('#gameFrame').src = d.url;
      $('#gameModal').classList.add('open');
      document.body.style.overflow = 'hidden';
    } else {
      showToast(d.message || d.error || 'Oyun hazırda açıla bilmir');
    }
  } catch {
    showToast('Backend bağlantısı yoxdur');
  }
}

async function loadGames() {
  try {
    const r = await fetch('/api/games?provider=all');
    const d = await r.json();
    state.games = Array.isArray(d.data) ? d.data : [];
    render();
    if (state.games[0]) showFeature(state.games[0]);
  } catch {
    grid.innerHTML = '<div class="loading">Oyun kataloqu yüklənmədi.</div>';
  }
}

function showFeature(g) {
  if (!g) return;
  $('#featureImage').style.backgroundImage = `url('${artUrl(g)}')`;
  $('#featureName').textContent = g.name;
  if ($('#featureProvider')) $('#featureProvider').textContent = providerLabel(g.provider);
  const index = Math.max(0, state.games.indexOf(g));
  $('#featureIndex').textContent = String((state.featured % 3) + 1).padStart(2, '0');
  $('#featurePlay').onclick = () => launch({ dataset: { id: g.gameid, provider: g.provider || 'pragmatic' } });
  void index;
}

let featureTimer;
setInterval(() => {
  if (!state.games.length) return;
  state.featured = (state.featured + 1) % Math.min(state.games.length, 24);
  showFeature(state.games[state.featured]);
}, 6500);
void featureTimer;

/* ---------------- filters / search ---------------- */

$$('.filter').forEach(b => {
  b.onclick = () => {
    $$('.filter').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.filter = b.dataset.filter || 'all';
    state.shown = 30;
    render();
  };
});

$('#search').oninput = e => {
  state.query = e.target.value;
  state.shown = 60;
  render();
};

$('#loadMore').onclick = () => {
  state.shown += 24;
  render();
};

/* ---------------- auth ---------------- */

const modal = $('#loginModal');

function authView(mode) {
  state.auth = mode;
  const reg = mode === 'register';
  const code = localStorage.getItem('redx_locale') || 'az';
  const t = AUTH_TEXT[code] || AUTH_TEXT.az;
  $('#modalTitle').textContent = reg ? t.regTitle : t.loginTitle;
  $('#tabRegister').classList.toggle('active', reg);
  $('#tabLogin').classList.toggle('active', !reg);
  $('#consentBox').style.display = reg ? 'block' : 'none';
  ['ageConsent', 'termsConsent'].forEach(id => {
    const el = $('#' + id);
    if (el) el.required = reg;
  });
  ['authCountry', 'authLanguage', 'authCurrency', 'authReferral'].forEach(id => {
    const el = $('#' + id);
    const label = el && el.closest('label');
    if (label) label.style.display = reg ? 'block' : 'none';
  });
  const lead = $('.auth-lead');
  if (lead) lead.textContent = reg ? t.regLead : t.loginLead;
  const submit = $('#authForm .primary');
  if (submit) submit.textContent = reg ? t.regSubmit : t.loginSubmit;
  const switchBtn = $('#switchAuth');
  if (switchBtn) switchBtn.textContent = reg ? t.toLogin : t.toReg;
}

function openAuth(mode) {
  authView(mode);
  modal.classList.add('open');
}

const authParams = new URLSearchParams(location.search);
const authNext = authParams.get('next') || '';
if (authParams.get('login') === '1' && !localStorage.getItem('redx_user')) {
  setTimeout(() => openAuth('login'), 150);
}

$('#openLogin').onclick = () => openAuth('login');
$('#openRegister').onclick = () => openAuth('register');
$$('[data-auth="register"]').forEach(b => { b.onclick = e => { e.preventDefault(); openAuth('register'); }; });
$('#closeLogin').onclick = () => modal.classList.remove('open');
$('#switchAuth').onclick = () => authView(state.auth === 'login' ? 'register' : 'login');
$('#tabLogin').onclick = () => authView('login');
$('#tabRegister').onclick = () => authView('register');
if ($('#footerLogin')) $('#footerLogin').onclick = e => { e.preventDefault(); openAuth('login'); };

['#locale', '#authLanguage'].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener('change', () => setTimeout(() => authView(state.auth), 0));
});

function readUser() {
  try { return JSON.parse(localStorage.getItem('redx_user') || 'null'); } catch { return null; }
}

function refreshAccountChip() {
  const user = readUser();
  const actions = $('.top-actions');
  let chip = $('#accountChip');

  if (!user) {
    if (chip) chip.remove();
    $('#openLogin').style.display = '';
    $('#openRegister').style.display = '';
    const drawer = $('#drawerLogin');
    if (drawer) drawer.style.display = '';
    return;
  }

  $('#openLogin').style.display = 'none';
  $('#openRegister').style.display = 'none';
  const drawer = $('#drawerLogin');
  if (drawer) drawer.style.display = 'none';

  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'accountChip';
    chip.className = 'account-chip';
    const locale = $('#locale');
    actions.insertBefore(chip, locale || $('#menu'));
  }

  const name = String(user.email || 'REDX').split('@')[0];
  const currency = user.currency || 'AZN';
  const balance = Number(user.balance || 0).toFixed(2);
  chip.innerHTML = `
    <span class="account-avatar">${esc(name.charAt(0).toUpperCase() || 'R')}</span>
    <span class="account-meta"><b>${esc(name)}</b><small>${esc(currency)} · ${esc(balance)}</small></span>
    <button class="account-logout" id="accountLogout" title="Çıxış" aria-label="Çıxış">↩</button>
  `;
  $('#accountLogout').onclick = () => {
    localStorage.removeItem('redx_token');
    localStorage.removeItem('redx_user');
    refreshAccountChip();
    showToast('Hesabdan çıxış edildi');
  };
}

$('#authForm').onsubmit = async e => {
  e.preventDefault();

  if (state.auth === 'register' && (!$('#ageConsent').checked || !$('#termsConsent').checked)) {
    showToast('18+ və istifadə şərtlərini təsdiqləyin');
    return;
  }

  const submit = $('#authForm .primary');
  const original = submit.textContent;
  submit.disabled = true;
  submit.textContent = state.auth === 'register' ? 'Hesab yaradılır...' : 'Daxil olunur...';

  try {
    const r = await fetch(`/api/auth/${state.auth}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: $('#authEmail').value.trim(),
        password: $('#authPassword').value,
        phone: '',
        birthDate: $('#authBirthDate')?.value || '',
        country: $('#authCountry')?.value || 'AZ',
        language: $('#authLanguage')?.value || 'az',
        currency: $('#authCurrency')?.value || 'AZN',
        referralCode: $('#authReferral')?.value.trim() || ''
      })
    });
    const d = await r.json();

    if (!r.ok) {
      showToast(d.error === 'Invalid email or password' ? 'Email və ya şifrə yanlışdır' : (d.error || 'Xəta baş verdi'));
      return;
    }

    if (d.token) localStorage.setItem('redx_token', d.token);
    if (d.user) localStorage.setItem('redx_user', JSON.stringify(d.user));
    refreshAccountChip();
    modal.classList.remove('open');
    if (authNext && authNext.startsWith('/') && !authNext.startsWith('//')) {
      location.assign(authNext);
      return;
    }
    const name = String(d.user?.email || $('#authEmail').value).split('@')[0];
    showToast(state.auth === 'register' ? `Xoş gəldin, ${name}!` : 'Yenidən xoş gəldin!');
  } catch {
    showToast('Backend bağlantısı yoxdur');
  } finally {
    submit.disabled = false;
    submit.textContent = original;
  }
};

refreshAccountChip();

/* ---------------- mobile menu ---------------- */

const nav = $('.topbar nav');
$('#menu').onclick = () => nav.classList.toggle('open');
$$('.topbar nav a').forEach(a => { a.onclick = () => nav.classList.remove('open'); });
if ($('#drawerLogin')) $('#drawerLogin').onclick = () => { nav.classList.remove('open'); openAuth('login'); };

/* ---------------- game modal ---------------- */

$('#closeGame').onclick = () => {
  $('#gameFrame').src = 'about:blank';
  $('#gameModal').classList.remove('open');
  document.body.style.overflow = '';
};

/* ---------------- lucky wheel ---------------- */

(async function initLuckyWheel() {
  let config = null;
  try {
    config = await (await fetch('/api/wheel')).json();
  } catch {
    config = null;
  }

  const promoBtn = $('#openWheelPromo');

  if (!config || !config.enabled) {
    if (promoBtn) {
      promoBtn.textContent = 'Hazırda bağlıdır';
      promoBtn.disabled = true;
    }
    return;
  }

  const rewards = Array.isArray(config.rewards) && config.rewards.length
    ? config.rewards
    : [{ label: 'Bonus', amount: 0 }];

  /* Reference layout: 16 narrow wedges. Repeat the configured rewards so every
     reward owns the same number of wedges and keeps its own colour. */
  const repeats = Math.max(1, Math.round(16 / rewards.length));
  const segCount = rewards.length * repeats;
  const segReward = Array.from({ length: segCount }, (_, s) => s % rewards.length);
  const per = 360 / segCount;
  let rotation = 0;

  const polar = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(200 + r * Math.cos(a)).toFixed(2)} ${(200 + r * Math.sin(a)).toFixed(2)}`;
  };
  const segPalette = [
    ['#2d8cff', '#0a51bb'],
    ['#23c95d', '#057a2d'],
    ['#d24bff', '#7d0a9e'],
    ['#ff3b3f', '#9d0509'],
    ['#ff2f8f', '#8d0343'],
    ['#ffb020', '#8a4d00']
  ];
  const segDefs = rewards.map((_, i) => {
    const [c0, c1] = segPalette[i % segPalette.length];
    return `<radialGradient id="wheelSeg${i}" cx="200" cy="200" r="181" gradientUnits="userSpaceOnUse">
        <stop offset="0.05" stop-color="${c0}" stop-opacity="0.55"/>
        <stop offset="0.22" stop-color="${c0}"/>
        <stop offset="0.86" stop-color="${c1}"/>
        <stop offset="1" stop-color="${c1}"/>
      </radialGradient>`;
  }).join('');
  const segPaths = segReward.map((ri, s) => {
    const a0 = s * per;
    const a1 = (s + 1) * per;
    const d = segCount === 1
      ? 'M 200 200 m -181 0 a 181 181 0 1 0 362 0 a 181 181 0 1 0 -362 0 Z'
      : `M 200 200 L ${polar(181, a0)} A 181 181 0 ${per > 180 ? 1 : 0} 1 ${polar(181, a1)} Z`;
    return `<path d="${d}" fill="url(#wheelSeg${ri})" stroke="rgba(255,246,224,0.78)" stroke-width="3" stroke-linejoin="round"/>`;
  }).join('');

  const labelText = segReward.map((ri, s) => {
    const r = rewards[ri];
    const label = String(r.label || (r.amount ? '₼' + r.amount : 'CƏHD'));
    const size = label.length > 4 ? 21 : 30;
    const mid = (s + 0.5) * per;
    return `<text class="wheel-num" font-size="${size}" transform="rotate(${mid.toFixed(3)} 200 200) translate(200 79) rotate(-90)" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
  }).join('');

  let bulbA = '';
  let bulbB = '';
  for (let i = 0; i < 16; i += 1) {
    const a = ((i * per + per / 2 - 90) * Math.PI) / 180;
    const x = (200 + 190.5 * Math.cos(a)).toFixed(2);
    const y = (200 + 190.5 * Math.sin(a)).toFixed(2);
    const bulb = `<g><circle cx="${x}" cy="${y}" r="5.6" fill="rgba(90,58,6,0.55)"/><circle cx="${x}" cy="${y}" r="3.9" fill="url(#wheelStud)"/></g>`;
    if (i % 2) bulbA += bulb; else bulbB += bulb;
  }

  const wheelFace = `
    <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="wheelRim" cx="34%" cy="20%" r="82%">
          <stop offset="0" stop-color="#fff8e0"/>
          <stop offset="0.24" stop-color="#f7d489"/>
          <stop offset="0.46" stop-color="#e0a63c"/>
          <stop offset="0.68" stop-color="#a9711a"/>
          <stop offset="0.86" stop-color="#5f3a07"/>
          <stop offset="1" stop-color="#2b1803"/>
        </radialGradient>
        <radialGradient id="wheelStud" cx="36%" cy="30%" r="72%">
          <stop offset="0" stop-color="#fff8dd"/>
          <stop offset="0.5" stop-color="#f2c76a"/>
          <stop offset="1" stop-color="#8a5a10"/>
        </radialGradient>
        <radialGradient id="wheelHubPlate" cx="42%" cy="30%" r="76%">
          <stop offset="0" stop-color="#fff6d5"/>
          <stop offset="0.34" stop-color="#f0c264"/>
          <stop offset="0.62" stop-color="#b8811f"/>
          <stop offset="0.84" stop-color="#6b430b"/>
          <stop offset="1" stop-color="#332003"/>
        </radialGradient>
        <radialGradient id="wheelShade" cx="200" cy="200" r="181" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/>
          <stop offset="0.36" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="0.82" stop-color="#000000" stop-opacity="0.08"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.34"/>
        </radialGradient>
        <radialGradient id="wheelGloss" cx="30%" cy="14%" r="74%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
          <stop offset="0.42" stop-color="#ffffff" stop-opacity="0.07"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        ${segDefs}
      </defs>
      <circle cx="200" cy="200" r="199" fill="url(#wheelRim)"/>
      <circle cx="200" cy="200" r="196" fill="none" stroke="rgba(64,36,4,0.55)" stroke-width="1.6"/>
      <circle cx="200" cy="200" r="183" fill="none" stroke="rgba(255,245,215,0.5)" stroke-width="1.4"/>
      ${segPaths}
      <circle cx="200" cy="200" r="181" fill="url(#wheelShade)"/>
      <circle cx="200" cy="200" r="181" fill="url(#wheelGloss)"/>
      <circle cx="200" cy="200" r="181" fill="none" stroke="rgba(255,248,226,0.9)" stroke-width="2.4"/>
      <circle cx="200" cy="200" r="52" fill="url(#wheelHubPlate)" stroke="rgba(58,33,3,0.55)" stroke-width="2"/>
      <circle cx="200" cy="200" r="47" fill="none" stroke="rgba(255,248,224,0.72)" stroke-width="1.4"/>
      <circle cx="200" cy="200" r="181" fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="1.2"/>
      <g class="wheel-nums">${labelText}</g>
      <g class="wheel-bulbs-a">${bulbA}</g>
      <g class="wheel-bulbs-b">${bulbB}</g>
    </svg>
  `;

  const modalBox = document.createElement('div');
  modalBox.className = 'wheel-modal';
  modalBox.innerHTML = `
    <div class="wheel-box">
      <div class="wheel-room" aria-hidden="true"></div>
      <button class="wheel-close" aria-label="Bağla" type="button">×</button>
      <div class="wheel-eyebrow">REDX ORIGINAL · CANLI STUDIYA</div>
      <div class="wheel-title">LUCKY <em>WHEEL</em></div>
      <div class="wheel-stage">
        <div class="wheel-floor" aria-hidden="true"></div>
        <div class="wheel-rig">
          <div class="wheel-disc">${wheelFace}</div>
          <div class="wheel-pointer" aria-hidden="true"></div>
          <div class="wheel-hub">
            <button class="wheel-spin" type="button">SPIN</button>
          </div>
        </div>
      </div>
      <div class="wheel-result" role="status" aria-live="polite">Şansını sına və bonus qazan.</div>
      <div class="wheel-note">Gündəlik limit: ${esc(config.dailyLimit)} fırlatma</div>
      <div class="wheel-fx" aria-hidden="true"></div>
    </div>
  `;
  document.body.appendChild(modalBox);

  const disc = $('.wheel-disc', modalBox);
  const spin = $('.wheel-spin', modalBox);
  const result = $('.wheel-result', modalBox);
  const fx = $('.wheel-fx', modalBox);

  function openWheel() {
    modalBox.classList.add('open');
    result.textContent = 'Şansını sına və bonus qazan.';
  }

  window.openLuckyWheel = openWheel;

  $('.wheel-close', modalBox).onclick = () => modalBox.classList.remove('open');
  modalBox.addEventListener('click', e => {
    if (e.target === modalBox) modalBox.classList.remove('open');
  });

  function wheelError(code) {
    if (code === 'Daily spin limit reached') return 'Bu gün üçün fırlatma limitiniz bitib. Sabah yenidən cəhd edin.';
    if (code === 'Wheel is disabled') return 'Çarx hazırda bağlıdır.';
    if (code === 'No rewards configured') return 'Çarx bonusları hələ təyin edilməyib.';
    if (code === 'Unauthorized' || code === 'Invalid token') return 'Sessiyanın vaxtı bitib. Yenidən daxil olun.';
    return 'Çarx fırladıla bilmədi. Bir az sonra yenidən cəhd edin.';
  }

  function burstConfetti() {
    if (!fx) return;
    const colors = ['#f4c15d', '#ffe9b8', '#e11d2e', '#ff6b7a', '#fff6e0'];
    fx.innerHTML = '';
    for (let i = 0; i < 30; i += 1) {
      const bit = document.createElement('i');
      bit.style.setProperty('--x', `${6 + Math.random() * 88}%`);
      bit.style.setProperty('--dx', `${Math.random() * 240 - 120}px`);
      bit.style.setProperty('--dy', `${120 + Math.random() * 230}px`);
      bit.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      bit.style.setProperty('--c', colors[i % colors.length]);
      bit.style.setProperty('--d', `${(Math.random() * 0.4).toFixed(2)}s`);
      fx.appendChild(bit);
    }
    setTimeout(() => { fx.innerHTML = ''; }, 2400);
  }

  spin.onclick = async () => {
    const token = localStorage.getItem('redx_token');
    if (!token) {
      modalBox.classList.remove('open');
      openAuth('login');
      showToast('Çarx üçün əvvəlcə daxil olun');
      return;
    }

    spin.disabled = true;
    result.textContent = 'Fırlanır...';

    try {
      const r = await fetch('/api/wheel/spin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
      const d = await r.json();

      if (!r.ok) {
        result.textContent = wheelError(d.error);
        spin.disabled = false;
        return;
      }

      const found = rewards.findIndex(x => (x.label || '') === d.spin.reward_label);
      const idx = found < 0 ? 0 : found;
      const pool = segReward.reduce((acc, ri, s) => (ri === idx ? acc.concat(s) : acc), []);
      const hit = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 0;
      const target = ((360 - (hit + 0.5) * per) % 360 + 360) % 360;
      const current = ((rotation % 360) + 360) % 360;
      const delta = ((target - current) % 360 + 360) % 360;
      rotation += 1440 + delta;
      disc.style.transform = `rotate(${rotation}deg)`;

      setTimeout(() => {
        const amount = Number(d.spin.reward_amount || 0);
        if (amount > 0) {
          result.textContent = `Təbriklər! ${d.spin.reward_label} bonus qazandınız 🎉`;
          result.classList.add('win');
          burstConfetti();
          setTimeout(() => result.classList.remove('win'), 3400);
        } else {
          result.textContent = 'Bu dəfə bonus çıxmadı. Yenidən cəhd edin.';
        }
        spin.disabled = false;
      }, 4800);
    } catch {
      result.textContent = 'Bağlantı xətası. Yenidən cəhd edin.';
      spin.disabled = false;
    }
  };

  const headerBtn = document.createElement('button');
  headerBtn.id = 'luckyWheelButton';
  headerBtn.innerHTML = '🎡 <span>Çarx</span>';
  headerBtn.className = 'wheel-top-button';
  headerBtn.type = 'button';
  headerBtn.onclick = openWheel;
  const actions = $('.top-actions');
  actions.insertBefore(headerBtn, $('#openLogin'));

  if (promoBtn) promoBtn.onclick = openWheel;
})();

loadGames();
