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
      <div class="game-visual" style="--art:url('${esc(art)}')">
        <img class="game-art-img" loading="lazy" src="${esc(art)}" alt="${esc(g.name)}"${fallback ? ` data-fallback="${esc(fallback)}" onerror="this.onerror=null;this.src=this.dataset.fallback"` : ''}>
        <span class="demo-chip">DEMO</span>
      </div>
      <div class="game-info">
        <div class="game-meta">
          <h3>${esc(g.name)}</h3>
          <span>${esc(providerLabel(g.provider))}</span>
        </div>
        <button class="play-btn" data-id="${esc(g.gameid)}" data-provider="${esc(g.provider || 'pragmatic')}" aria-label="${esc(g.name)} oyna">▶</button>
      </div>
    </article>
  `;
  }).join('');

  $$('.play-btn', grid).forEach(b => { b.onclick = () => launch(b); });
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
  const per = 360 / rewards.length;
  let rotation = 0;

  const modalBox = document.createElement('div');
  modalBox.className = 'wheel-modal';
  modalBox.innerHTML = `
    <div class="wheel-box">
      <button class="wheel-close" aria-label="Bağla">×</button>
      <div class="wheel-eyebrow">REDX ORIGINAL</div>
      <div class="wheel-title">LUCKY WHEEL</div>
      <div class="wheel-stage">
        <div class="wheel-pointer">▼</div>
        <div class="wheel-disc">
          <div class="wheel-labels">
            ${rewards.map((r, i) => {
              const label = r.label || (r.amount ? '₼' + r.amount : 'CƏHD');
              return `<span style="--r:${(i + 0.5) * per - 90}deg">${esc(label)}</span>`;
            }).join('')}
          </div>
        </div>
        <button class="wheel-spin">SPIN</button>
      </div>
      <div class="wheel-result">Şansını sına və bonus qazan.</div>
      <div class="wheel-note">Gündəlik limit: ${esc(config.dailyLimit)} fırlatma</div>
    </div>
  `;
  document.body.appendChild(modalBox);

  const disc = $('.wheel-disc', modalBox);
  const spin = $('.wheel-spin', modalBox);
  const result = $('.wheel-result', modalBox);

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

      const idx = Math.max(0, rewards.findIndex(x => (x.label || '') === d.spin.reward_label));
      const target = ((360 - (idx + 0.5) * per) % 360 + 360) % 360;
      rotation += 1440 + target;
      disc.style.transform = `rotate(${rotation}deg)`;

      setTimeout(() => {
        const amount = Number(d.spin.reward_amount || 0);
        result.textContent = amount > 0
          ? `Təbriklər! ${d.spin.reward_label} bonus qazandınız 🎉`
          : 'Bu dəfə bonus çıxmadı. Yenidən cəhd edin.';
        spin.disabled = false;
      }, 4600);
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
