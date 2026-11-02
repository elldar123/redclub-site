const categories = document.querySelectorAll('.category');
const cards = document.querySelectorAll('.game-card');
const search = document.querySelector('#gameSearch');
const empty = document.querySelector('#emptyState');
const toast = document.querySelector('#toast');

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

document.querySelectorAll('.play-btn').forEach(button => button.addEventListener('click', async () => {
  toast.textContent = `${button.dataset.game} üçün bağlantı yoxlanılır...`;
  toast.classList.add('show');
  try {
    const response = await fetch('/api/launch', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ gameId: button.dataset.game, userId: 'demo-user-001', mode: 'demo' }) });
    const result = await response.json();
    toast.textContent = result.setupRequired ? 'API tokeni əlavə edilməlidir.' : (result.launchUrl ? 'Oyun açılır...' : 'Launch endpoint cavabını gözləyir.');
    if (result.launchUrl) window.location.href = result.launchUrl;
  } catch { toast.textContent = 'Backend serveri işləmir. node server.js başladın.'; }
  setTimeout(() => toast.classList.remove('show'), 3000);
}));

document.querySelector('#menuToggle').addEventListener('click', () => document.querySelector('.main-nav').classList.toggle('open'));
document.querySelector('#searchToggle').addEventListener('click', () => {
  search.focus();
  document.querySelector('#games').scrollIntoView({ behavior: 'smooth' });
});

let balance = 25;
let selectedAmount = 25;
document.querySelectorAll('.amounts button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.amounts button').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected');
  selectedAmount = Number(button.dataset.amount);
  document.querySelector('#depositAmount').textContent = selectedAmount;
}));
document.querySelector('#depositBtn').addEventListener('click', () => {
  balance += selectedAmount;
  document.querySelector('#balance').textContent = balance.toFixed(2);
  document.querySelector('#cardBalance').textContent = balance.toFixed(2);
  toast.textContent = `₼${selectedAmount} balansına əlavə edildi!`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
});
document.querySelector('#balanceBtn').addEventListener('click', () => document.querySelector('#deposit').scrollIntoView({behavior:'smooth'}));

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
setInterval(() => showSlide(currentSlide + 1), 5000);
document.querySelectorAll('.slide-play').forEach(button => button.addEventListener('click', () => {
  toast.textContent = `${button.dataset.game} başlayır...`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}));
