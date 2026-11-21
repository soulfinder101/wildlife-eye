// Installable-app glue: service worker, install button, and the phone layout
// (bottom tabs that switch between the globe, the species list and the article).
(() => {
  const $ = (s) => document.querySelector(s);
  const phone = matchMedia('(max-width: 900px)');

  // ----- Phone views -----
  function setView(v) {
    document.body.dataset.view = v;
    document.querySelectorAll('#mnav button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    document.body.classList.remove('layers-open');
    if (v === 'globe') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  window.WE_view = (v) => { if (phone.matches) setView(v); };
  setView(location.hash.length > 1 ? 'article' : 'globe');
  $('#mnav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });

  // Actions that show something on the globe jump to the globe on a phone.
  document.addEventListener('click', (e) => {
    if (!phone.matches) return;
    if (e.target.closest('[data-fly],[data-route],#fly-range,#fly-sightings,[data-group-home]')) setView('globe');
    else if (e.target.closest('[data-home]')) setView('species');
  }, true);

  // ----- Layers menu (collapsed on phones) -----
  $('#layers-btn').addEventListener('click', () => document.body.classList.toggle('layers-open'));
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('layers-open') && !e.target.closest('#layers,#layers-btn')) document.body.classList.remove('layers-open');
  });

  // ----- Install -----
  let deferred = null;
  const btn = $('#install-btn');
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null; btn.hidden = true;
  });
  addEventListener('appinstalled', () => { btn.hidden = true; });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e)));
  }
})();
