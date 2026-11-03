const categories = document.querySelectorAll('.category');
let cards = document.querySelectorAll('.game-card');
const search = document.querySelector('#gameSearch');
const empty = document.querySelector('#emptyState');
const toast = document.querySelector('#toast');
const loadMore = document.querySelector('#loadMoreGames');
let allProviderGames = [];
let gamesShown = 24;
let featuredIndex = 0;

function filterGames() {
  const active = document.querySelector('.category.active').dataset.category;
  const term = search.value.toLowerCase().trim();
  let visible = 0;
  cards.forEach(card => {
    const matchesCategory = active === 'all' || card.dataset.category === active;
    const matchesSearch = card.dataset.name.toLowerCase().includes(term);
    card.classList.toggle('hidden', !(matchesCategory && matchesSearch));
    if (matchesCategory && matchesSearch) visible++;
  });
  empty.style.display = visible ? 'none' : 'block';
}

categories.forEach(button => button.addEventListener('click', () => {
  categories.forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  filterGames();
}));
search.addEventListener('input', filterGames);

function bindPlayButtons() { document.querySelectorAll('.play-btn').forEach(button => button.addEventListener('click', async () => {
  toast.textContent = `${button.dataset.game} üçün bağlantı yoxlanılır...`; toast.classList.add('show');
  try { const response = await fetch('/api/launch', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ gameId: button.dataset.gameId || button.dataset.game, provider: button.dataset.provider || 'pragmatic', userId: 'demo001' }) }); const result = await response.json(); toast.textContent = result.url ? 'Oyun açılır...' : (result.setupRequired ? 'API tokeni əlavə edilməlidir.' : (result.message || 'Launch cavabı alındı.')); if (result.url) openGameModal(result.url, button.dataset.game); }
  catch { toast.textContent = 'Backend serveri işləmir.'; } setTimeout(() => toast.classList.remove('show'), 3000);
})); }
bindPlayButtons();

document.querySelector('#menuToggle').addEventListener('click', () => document.querySelector('.main-nav').classList.toggle('open'));
document.querySelector('#searchToggle').addEventListener('click', () => {
  search.focus();
  document.querySelector('#games').scrollIntoView({ behavior: 'smooth' });
});

const slides = document.querySelectorAll('.hero-slide');
const dots = document.querySelectorAll('.carousel-dot');
let currentSlide = 0;
function showSlide(index) {
  currentSlide = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => slide.classList.toggle('active', i === currentSlide));
  dots.forEach((dot, i) => dot.classList.toggle('active', i === currentSlide));
}
document.querySelector('#nextSlide').addEventListener('click', () => showSlide(currentSlide + 1));
document.querySelector('#prevSlide').addEventListener('click', () => showSlide(currentSlide - 1));
dots.forEach(dot => dot.addEventListener('click', () => showSlide(Number(dot.dataset.slide))));
async function loadProviderGames() {
  try { const response = await fetch('/api/games?provider=all'); const result = await response.json(); if (!Array.isArray(result.data) || !result.data.length) return; allProviderGames = result.data; document.querySelector('#gameCount').textContent = allProviderGames.length.toLocaleString('en-US'); renderGames(); showFeaturedGame(allProviderGames[0]); } catch { /* keep built-in catalogue */ } }
function showFeaturedGame(game) { const slide = slides[0]; if (!slide || !game) return; let art = slide.querySelector('.live-art'); if (!art) { art = document.createElement('img'); art.className = 'live-art'; slide.appendChild(art); } art.src = game.iconurl3 || game.iconurl1 || ''; art.alt = ''; art.loading = 'eager'; const play = slide.querySelector('.slide-play'); play.dataset.game = game.name; play.dataset.gameId = game.gameid; play.dataset.provider = game.provider || 'pragmatic'; }
function renderGames() { const grid = document.querySelector('#gameGrid'); grid.innerHTML = allProviderGames.slice(0, gamesShown).map(game => `<article class="game-card" data-category="all" data-name="${escapeHtml(game.name)}"><div class="game-visual api-game-image"><img class="game-art-img" loading="lazy" src="${escapeAttr(game.iconurl3 || game.iconurl1 || '')}" alt=""></div><div class="game-info"><div><h3>${escapeHtml(game.name)}</h3><p>${escapeHtml(game.vendorid || game.provider || 'Casino')}</p></div><button class="play-btn" data-game="${escapeHtml(game.name)}" data-game-id="${game.gameid}" data-provider="${game.provider || 'pragmatic'}">▶</button></div></article>`).join(''); cards = document.querySelectorAll('.game-card'); bindPlayButtons(); loadMore.style.display = gamesShown < allProviderGames.length ? 'block' : 'none'; }
loadMore.addEventListener('click', () => { gamesShown += 24; renderGames(); });
setInterval(() => { if (allProviderGames.length) { featuredIndex = (featuredIndex + 1) % allProviderGames.length; showFeaturedGame(allProviderGames[featuredIndex]); } }, 5000);
const betSlip = document.querySelector('#betSlip');
const slipItems = document.querySelector('#slipItems');
const slipCount = document.querySelector('#slipCount');
const slipTotal = document.querySelector('#slipTotal');
let picks = [];
document.querySelectorAll('.odds button').forEach(button => button.addEventListener('click', () => {
  const pick = { match: button.dataset.match, choice: button.dataset.pick, odd: Number(button.dataset.odd) };
  if (!Number.isFinite(pick.odd)) return;
  picks = picks.filter(item => item.match !== pick.match);
  picks.push(pick);
  renderSlip();
  betSlip.classList.add('open');
}));
function renderSlip() { slipCount.textContent = picks.length; slipItems.innerHTML = picks.length ? picks.map(item => `<div class="slip-item">${escapeHtml(item.match)}<b>${escapeHtml(item.choice)} · ${item.odd.toFixed(2)}</b></div>`).join('') : '<p>Kuponunuz boşdur.<br /><small>Odds seçərək kupon yaradın.</small></p>'; slipTotal.textContent = picks.length ? picks.reduce((total, item) => total * item.odd, 1).toFixed(2) : '0.00'; }
document.querySelector('#slipToggle').addEventListener('click', () => betSlip.classList.toggle('open'));
document.querySelector('#closeSlip').addEventListener('click', () => betSlip.classList.remove('open'));
document.querySelector('#slipSubmit').addEventListener('click', () => { toast.textContent = 'Kupon sistemi real backend-dən sonra aktiv olacaq.'; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500); });
const gameModal=document.querySelector('#gameModal'); const gameFrame=document.querySelector('#gameFrame');
function openGameModal(url,title){ gameFrame.src=url; document.querySelector('#gameModalTitle').textContent=title||'Oyun'; gameModal.classList.add('open'); document.body.style.overflow='hidden'; }
function closeGameModal(){ gameFrame.src='about:blank'; gameModal.classList.remove('open'); document.body.style.overflow=''; }
document.querySelector('#closeGameModal').addEventListener('click',closeGameModal);
const authModal = document.querySelector('#auth');
document.querySelector('#profileBtn').addEventListener('click', () => authModal.classList.add('open'));
document.querySelector('.register-btn').addEventListener('click', event => { event.preventDefault(); authModal.classList.add('open'); });
document.querySelector('#authClose').addEventListener('click', () => authModal.classList.remove('open'));
let authMode='login';
document.querySelector('#authSwitch').addEventListener('click',()=>{authMode=authMode==='login'?'register':'login';document.querySelector('#authTitle').textContent=authMode==='login'?'Hesabına daxil ol':'Yeni hesab yarat';document.querySelector('#authForm button').textContent=authMode==='login'?'Daxil ol →':'Qeydiyyatdan keç →';document.querySelector('#authSwitch').textContent=authMode==='login'?'Hesabın yoxdur? Qeydiyyatdan keç':'Artıq hesabın var? Giriş et'});
document.querySelector('#authForm').addEventListener('submit',async event=>{event.preventDefault();const inputs=event.currentTarget.querySelectorAll('input');try{const response=await fetch(`/api/auth/${authMode}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:inputs[0].value,password:inputs[1].value})});const result=await response.json();if(!response.ok)throw Error(result.error||'Əməliyyat mümkün olmadı');localStorage.setItem('redx_token',result.token);authModal.classList.remove('open');toast.textContent=authMode==='login'?'Uğurla daxil oldunuz.':'Qeydiyyat tamamlandı.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2500)}catch(error){toast.textContent=error.message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3000)}});
const wheelModal=document.querySelector('#wheelModal'); const bigWheel=document.querySelector('#bigWheel'); const wheelMessage=document.querySelector('#wheelMessage');
function spinWheel(){bigWheel.style.transform=`rotate(${720+Math.floor(Math.random()*360)}deg)`;wheelMessage.textContent='Şansın hazırlanır...';setTimeout(()=>wheelMessage.textContent=['₼10 bonus','Pulsuz oyun','₼25 bonus','Yenidən cəhd et'][Math.floor(Math.random()*4)],1100)}
document.querySelector('#wheelBtn').addEventListener('click',()=>{wheelModal.classList.add('open');spinWheel()});document.querySelector('#spinAgain').addEventListener('click',spinWheel);document.querySelector('#closeWheel').addEventListener('click',()=>wheelModal.classList.remove('open'));
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function escapeAttr(value) { return String(value || '').replace(/['"\\]/g, char => `\\${char}`); }
loadProviderGames();

