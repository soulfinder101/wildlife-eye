/* Wildlife Eye — a god's-eye globe that is an encyclopedia of wildlife.
 * Atlas data: data/wild.js (built from the five atlas pages).
 * Live sources (no keys): Wikipedia, Wikimedia, iNaturalist, GBIF, OpenAlex, Europe PMC.
 */
'use strict';
const W = window.WILD;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : u && u.startsWith('//') ? 'https:' + u : '#');
const GROUP = Object.fromEntries(W.groups.map((g) => [g.id, g]));
const SPECIES = Object.fromEntries(W.species.map((s) => [s.id, s]));
const ROUTE = Object.fromEntries(W.routes.map((r) => [r.id, r]));
const MONTH = new Date().getMonth() + 1;
const inSeason = (c) => c.months === 'all' || !c.months || c.months.includes(MONTH);
const camsFor = (sp) => {
  const direct = W.cams.filter((c) => (c.species || []).includes(sp.id));
  const general = W.cams.filter((c) => c.group === sp.group && !(c.species || []).length);
  return { direct, general };
};

// ---------- cached fetch ----------
const cache = new Map();
async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { headers: { Accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}
const cleanLatin = (l = '') =>
  l.split('/')[0].replace(/\(.*?\)/g, '').replace(/\b(subsp|spp|sp|ssp|var)\.?/g, '').replace(/[×x] /g, '').replace(/\s+/g, ' ').trim();
const cleanName = (n = '') => n.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

// ---------- Globe ----------
Cesium.Ion.defaultAccessToken = '';
const SAT = () => new Cesium.UrlTemplateImageryProvider({
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maximumLevel: 19, credit: 'Esri, Maxar, Earthstar Geographics',
});
const DARK = () => new Cesium.UrlTemplateImageryProvider({
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: 'abcd',
  maximumLevel: 18, credit: '© OpenStreetMap contributors © CARTO',
});
const viewer = new Cesium.Viewer('globe', {
  baseLayer: new Cesium.ImageryLayer(SAT()),
  baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
  navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false,
});
const scene = viewer.scene;
scene.globe.enableLighting = true;
scene.globe.nightFadeOutDistance = 2.0e7;
scene.globe.nightFadeInDistance = 5.0e7;
scene.skyAtmosphere.show = true;
scene.fog.enabled = true;
viewer.clock.shouldAnimate = true; // real time sun position
// Start closer on tall, narrow screens (phones) so the globe fills the width.
const homeHeight = () => (innerHeight > innerWidth * 1.2 ? 1.9e7 : 2.2e7);
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-30, 25, homeHeight()) });

const layers = {
  routes: new Cesium.CustomDataSource('routes'),
  ranges: new Cesium.CustomDataSource('ranges'),
  cams: new Cesium.CustomDataSource('cams'),
  sightings: new Cesium.CustomDataSource('sightings'),
  feed: new Cesium.CustomDataSource('feed'),
};
Object.values(layers).forEach((d) => viewer.dataSources.add(d));
let densityLayer = null;
let state = { sel: null, group: 'all', tab: 'overview', gbifKey: null };
const color = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

function pinCanvas(fill, glyph) {
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(20, 20, 15, 0, Math.PI * 2);
  g.fillStyle = 'rgba(5,9,13,.85)'; g.fill();
  g.lineWidth = 3; g.strokeStyle = fill; g.stroke();
  g.font = '17px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, 20, 21);
  return c;
}
const LIVE_PIN = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 34;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(17, 17, 12, 0, Math.PI * 2); g.fillStyle = '#ff4d5e'; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(13, 11); g.lineTo(23, 17); g.lineTo(13, 23); g.closePath(); g.fill();
  return c;
})();

function drawRoutes(list) {
  layers.routes.entities.removeAll();
  for (const r of list) {
    const sp = SPECIES[r.species];
    const col = GROUP[sp.group].color;
    const add = (line, dashed) =>
      layers.routes.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(line.flat()),
          width: dashed ? 2 : 3,
          arcType: Cesium.ArcType.GEODESIC,
          material: dashed
            ? new Cesium.PolylineDashMaterialProperty({ color: color(col, 0.8), dashLength: 12 })
            : new Cesium.PolylineGlowMaterialProperty({ color: color(col, 0.9), glowPower: 0.25 }),
        },
        properties: { kind: 'route', id: r.id },
      });
    (r.lines || []).forEach((l) => add(l, false));
    (r.dashed || []).forEach((l) => add(l, true));
  }
}
function drawFlyways() {
  for (const f of W.extras.birds.flyways) {
    layers.routes.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(f.line.flat()), width: 10, arcType: Cesium.ArcType.GEODESIC,
        material: color('#ffd54f', 0.12),
      },
      properties: { kind: 'flyway', name: f.name, d: f.d, spp: f.spp },
    });
  }
}
function drawRanges(sp) {
  layers.ranges.entities.removeAll();
  if (!sp) return;
  const col = GROUP[sp.group]?.color || '#5ef2c8';
  const add = (names, fill, label) => {
    for (const n of names || []) {
      for (const ring of W.countries[n] || []) {
        layers.ranges.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
            material: fill, height: 0, outline: true, outlineColor: Cesium.Color.WHITE.withAlpha(0.35),
          },
          properties: { kind: 'country', name: n, label },
        });
      }
    }
  };
  add(sp.native, color('#5ef2c8', 0.4), 'Native range');
  add(sp.lost, color('#ff4d5e', 0.45), 'Former range, now lost');
  add(sp.introduced, color('#ba68c8', 0.45), 'Introduced or invasive');
}
function drawCams(list) {
  layers.cams.entities.removeAll();
  for (const c of list) {
    if (c.lon == null) continue;
    layers.cams.entities.add({
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
      billboard: { image: LIVE_PIN, scale: inSeason(c) ? 0.8 : 0.55, color: inSeason(c) ? Cesium.Color.WHITE : Cesium.Color.WHITE.withAlpha(0.55), disableDepthTestDistance: Number.POSITIVE_INFINITY },
      properties: { kind: 'cam', t: c.t },
    });
  }
}
function setDensity(key) {
  if (densityLayer) { viewer.imageryLayers.remove(densityLayer, true); densityLayer = null; }
  if (!key || !$('[data-layer=density]').checked) return;
  densityLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?taxonKey=${key}&bin=hex&hexPerTile=70&style=purpleYellow-noborder.poly`,
    maximumLevel: 12, credit: 'GBIF.org',
  }));
  densityLayer.alpha = 0.75;
}
function drawSightings(obs) {
  layers.sightings.entities.removeAll();
  for (const o of obs) {
    const ll = o.geojson?.coordinates;
    if (!ll) continue;
    layers.sightings.entities.add({
      position: Cesium.Cartesian3.fromDegrees(ll[0], ll[1]),
      point: { pixelSize: 9, color: Cesium.Color.fromCssColorString('#5ef2c8'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      properties: { kind: 'sighting', id: o.id },
    });
  }
}
function flyToEntities(ds) {
  if (ds.entities.values.length) viewer.flyTo(ds, { duration: 1.6, offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, 0) });
}
function flyTo(lon, lat, h = 1.5e6) {
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, h), duration: 1.8 });
}

// ---------- HUD ----------
setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);
const moveHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
moveHandler.setInputAction((m) => {
  const cart = viewer.camera.pickEllipsoid(m.endPosition);
  if (!cart) return;
  const c = Cesium.Cartographic.fromCartesian(cart);
  $('#cursor').textContent = `lat ${Cesium.Math.toDegrees(c.latitude).toFixed(2)}  lon ${Cesium.Math.toDegrees(c.longitude).toFixed(2)}`;
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

$('#layers').addEventListener('change', (e) => {
  const l = e.target.dataset.layer;
  if (e.target.id === 'basemap') {
    const base = viewer.imageryLayers.get(0);
    viewer.imageryLayers.remove(base, true);
    viewer.imageryLayers.add(new Cesium.ImageryLayer(e.target.value === 'dark' ? DARK() : SAT()), 0);
    return;
  }
  if (l === 'night') scene.globe.enableLighting = e.target.checked;
  else if (l === 'density') setDensity(state.gbifKey);
  else if (l === 'feed') e.target.checked ? startFeed() : stopFeed();
  else if (layers[l]) layers[l].show = e.target.checked;
});

// Live sightings feed: newest wildlife observations worldwide from iNaturalist.
let feedTimer = null;
async function loadFeed() {
  try {
    const j = await fetch('https://api.inaturalist.org/v1/observations?iconic_taxa=Mammalia,Aves,Insecta,Reptilia,Amphibia&photos=true&geo=true&order_by=created_at&per_page=100').then((r) => r.json());
    layers.feed.entities.removeAll();
    for (const o of j.results) {
      const ll = o.geojson?.coordinates;
      if (!ll) continue;
      feedObs.set(String(o.id), o);
      layers.feed.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ll[0], ll[1]),
        point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#ffe082'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        properties: { kind: 'feed', id: String(o.id) },
      });
    }
  } catch (e) { console.warn('feed', e); }
}
const feedObs = new Map();
function startFeed() { layers.feed.show = true; loadFeed(); feedTimer = setInterval(loadFeed, 60000); }
function stopFeed() { clearInterval(feedTimer); layers.feed.show = false; }

// ---------- Picking & popup ----------
const popup = $('#popup');
const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
const sightingObs = new Map();
clickHandler.setInputAction((ev) => {
  popup.hidden = true;
  const picked = scene.pick(ev.position);
  const p = picked?.id?.properties;
  if (!p) return;
  const kind = p.kind?.getValue();
  const at = (html) => {
    popup.innerHTML = html;
    popup.hidden = false;
    const x = Math.min(ev.position.x + 14, innerWidth - 320);
    const y = Math.min(ev.position.y + 14, innerHeight - popup.offsetHeight - 10);
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
  };
  if (kind === 'route') {
    const r = ROUTE[p.id.getValue()];
    const sp = SPECIES[r.species];
    at(`<h5>${esc(sp.name)} · ${esc(r.name)}</h5><div class="muted">${esc(r.facts?.Distance || '')} ${esc(r.facts?.Timing || '')}</div><div class="actions" style="margin-top:8px"><button class="btn primary" data-open="${esc(sp.id)}">Open in encyclopedia</button></div>`);
  } else if (kind === 'flyway') {
    at(`<h5>${esc(p.name.getValue())}</h5><div class="muted">${esc(p.spp.getValue())}</div><p>${esc(p.d.getValue())}</p>`);
  } else if (kind === 'country') {
    at(`<h5>${esc(p.name.getValue())}</h5><div class="muted">${esc(p.label.getValue())}</div>`);
  } else if (kind === 'cam') {
    const c = W.cams.find((x) => x.t === p.t.getValue());
    at(camHTML(c, true));
  } else if (kind === 'sighting' || kind === 'feed') {
    const o = (kind === 'feed' ? feedObs : sightingObs).get(String(p.id.getValue()));
    if (o) at(obsHTML(o));
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { e.preventDefault(); popup.hidden = true; select(open.dataset.open); return; }
  const fly = e.target.closest('[data-fly]');
  if (fly) { const [lo, la, h] = fly.dataset.fly.split(',').map(Number); flyTo(lo, la, h || 4e5); return; }
  const route = e.target.closest('[data-route]');
  if (route) { const r = ROUTE[route.dataset.route]; drawRoutes([r]); flyToEntities(layers.routes); return; }
  const embed = e.target.closest('[data-embed]');
  if (embed) { openEmbed(embed.dataset.embed, embed.dataset.title); return; }
  const img = e.target.closest('[data-img]');
  if (img) { openModal(img.dataset.title || 'Picture', `<img src="${esc(img.dataset.img)}" alt=""><div class="cap">${img.dataset.cap || ''}</div>`); }
});

function obsHTML(o) {
  const photo = o.photos?.[0]?.url?.replace('square', 'medium');
  const name = o.taxon?.preferred_common_name || o.taxon?.name || 'Unidentified';
  return `${photo ? `<img src="${esc(photo)}" alt="">` : ''}<h5>${esc(name)}</h5>
    <div class="muted"><i>${esc(o.taxon?.name || '')}</i></div>
    <div>${esc(o.place_guess || '')}</div>
    <div class="muted">${esc(o.observed_on || o.created_at?.slice(0, 10) || '')} · by ${esc(o.user?.login || '?')} · ${esc(o.quality_grade || '')}</div>
    <div class="actions" style="margin-top:6px"><a class="btn" target="_blank" rel="noopener" href="${esc(safeUrl(o.uri))}">iNaturalist ↗</a></div>`;
}

// ---------- Modal ----------
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-content').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; $('#modal-content').innerHTML = ''; }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); popup.hidden = true; } });
function openEmbed(url, title) {
  openModal(title || 'Live', `<iframe src="${esc(safeUrl(url))}" allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>
    <div class="cap">If this stays blank, the camera's site does not allow embedding. <a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">Open the live stream in a new tab ↗</a></div>`);
}

// ---------- Index (left panel) ----------
function renderChips() {
  const chips = [{ id: 'all', label: 'All' }, ...W.groups];
  $('#chips').innerHTML = chips.map((g) => `<button class="chip ${state.group === g.id ? 'on' : ''}" data-group="${g.id}">${g.glyph ? g.glyph + ' ' : ''}${esc(g.label)}</button>`).join('');
}
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  state.group = b.dataset.group;
  renderChips();
  renderList();
  if (!state.sel) showGroupOnGlobe();
});
let gbifResults = null; // null = searching
function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  const items = W.species.filter((s) => (state.group === 'all' || s.group === state.group) && (!q || `${s.name} ${s.latin} ${s.sub}`.toLowerCase().includes(q)));
  let html = '';
  let lastHead = '';
  for (const s of items) {
    const head = `${GROUP[s.group].glyph} ${GROUP[s.group].label} · ${s.sub}`;
    if (head !== lastHead) { html += `<h4>${esc(head)}</h4>`; lastHead = head; }
    const live = camsFor(s).direct.some(inSeason);
    html += `<button class="item ${state.sel?.id === s.id ? 'sel' : ''}" data-open="${esc(s.id)}"><span class="dot" style="background:${GROUP[s.group].color}"></span><span>${esc(s.name)}<i>${esc(s.latin)}</i></span>${live ? '<span class="live">● LIVE</span>' : ''}</button>`;
  }
  if (q.length >= 3) {
    html += `<h4>🌍 Any species on Earth (GBIF)</h4>`;
    html += gbifResults === null
      ? `<div class="loading" style="padding:4px 14px">Searching the world's species…</div>`
      : gbifResults.length ? gbifResults.map((r) => `<button class="item" data-open="gbif-${r.key}"><span class="dot" style="background:var(--accent)"></span><span>${esc(r.vernacularName || r.canonicalName)}<i>${esc(r.canonicalName)} · ${esc((r.rank || '').toLowerCase())}${r.class ? ' · ' + esc(r.class) : ''}</i></span></button>`).join('')
      : '<p class="muted" style="padding:0 14px">No matches in GBIF.</p>';
  } else if (!items.length) html += `<p class="muted" style="padding:14px">Type 3+ letters to search every animal on Earth.</p>`;
  $('#list').innerHTML = html;
}
let searchTimer;
$('#q').addEventListener('input', () => {
  gbifResults = null;
  renderList();
  clearTimeout(searchTimer);
  const q = $('#q').value.trim();
  if (q.length < 3) return;
  searchTimer = setTimeout(async () => {
    try {
      const j = await getJSON(`https://api.gbif.org/v1/species/search?q=${encodeURIComponent(q)}&kingdomKey=1&status=ACCEPTED&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=20`);
      const seen = new Set();
      gbifResults = j.results.filter((r) => ['SPECIES', 'SUBSPECIES', 'GENUS', 'FAMILY'].includes(r.rank)).map((r) => ({
        key: r.nubKey || r.key, canonicalName: r.canonicalName, rank: r.rank, class: r.class,
        vernacularName: (r.vernacularNames || []).find((v) => v.language === 'eng')?.vernacularName,
      })).filter((r) => r.key && !seen.has(r.key) && seen.add(r.key));
      const ql = q.toLowerCase();
      const score = (r) => ((r.vernacularName || '').toLowerCase() === ql || (r.canonicalName || '').toLowerCase() === ql ? 0 : 2) + (r.rank === 'SPECIES' ? 0 : 1);
      gbifResults = gbifResults.sort((a, b) => score(a) - score(b)).slice(0, 10);
      renderList();
    } catch (e) { console.warn(e); gbifResults = []; renderList(); }
  }, 350);
});

// ---------- Selection ----------
async function select(id) {
  let sp = SPECIES[id];
  if (!sp && id.startsWith('gbif-')) {
    const key = id.slice(5);
    const t = await getJSON(`https://api.gbif.org/v1/species/${key}`);
    let common;
    try {
      const v = await getJSON(`https://api.gbif.org/v1/species/${key}/vernacularNames?limit=50`);
      common = v.results.find((x) => x.language === 'eng')?.vernacularName;
    } catch {}
    sp = {
      id, dynamic: true, group: null, name: common ? common[0].toUpperCase() + common.slice(1) : t.canonicalName,
      latin: t.canonicalName, sub: [t.class, t.order, t.family].filter(Boolean).join(' › '), gbifKey: Number(key),
      facts: { Kingdom: t.kingdom, Phylum: t.phylum, Class: t.class, Order: t.order, Family: t.family, Rank: t.rank && t.rank.toLowerCase() },
    };
    SPECIES[id] = sp;
  }
  if (!sp) return;
  state.sel = sp;
  state.tab = 'overview';
  location.hash = id;
  renderList();
  // globe
  layers.sightings.entities.removeAll();
  const rs = (sp.routes || []).map((r) => ROUTE[r]).filter(Boolean);
  drawRoutes(rs);
  drawRanges(sp);
  const { direct, general } = sp.group ? camsFor(sp) : { direct: [], general: [] };
  drawCams([...direct, ...general]);
  state.gbifKey = null;
  setDensity(null);
  renderArticle();
  if (rs.length) flyToEntities(layers.routes);
  else if (layers.ranges.entities.values.length) flyToEntities(layers.ranges);
  // live lookups
  gbifKeyFor(sp).then((k) => { if (state.sel === sp) { state.gbifKey = k; setDensity(k); } });
  loadSightings(sp);
}
async function gbifKeyFor(sp) {
  if (sp.gbifKey) return sp.gbifKey;
  try {
    const m = await getJSON(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(cleanLatin(sp.latin))}&kingdom=Animalia`);
    if (m.matchType !== 'NONE' && m.usageKey) return (sp.gbifKey = m.usageKey);
  } catch {}
  return null;
}
async function wikiFor(sp) {
  if (sp.wiki !== undefined) return sp.wiki;
  const tries = [cleanLatin(sp.latin), cleanName(sp.name), sp.name];
  for (const t of tries) {
    if (!t) continue;
    try {
      const s = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`);
      if (s.type !== 'disambiguation' && s.extract) return (sp.wiki = s);
    } catch {}
  }
  try {
    const q = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(`${cleanName(sp.name)} ${cleanLatin(sp.latin)}`)}`);
    const t = q.query.search[0]?.title;
    if (t) return (sp.wiki = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`));
  } catch {}
  return (sp.wiki = null);
}
async function inatFor(sp, n = 60) {
  const name = cleanLatin(sp.latin);
  return getJSON(`https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(name)}&photos=true&geo=true&quality_grade=research&order_by=observed_on&per_page=${n}`);
}
async function loadSightings(sp) {
  try {
    const j = await inatFor(sp);
    if (state.sel !== sp) return;
    j.results.forEach((o) => sightingObs.set(String(o.id), o));
    sp.inat = j;
    drawSightings(j.results);
    if (!(sp.routes || []).length && !layers.ranges.entities.values.length && j.results.length) viewer.flyTo(layers.sightings, { duration: 1.6 });
    if (state.tab === 'map' || state.tab === 'live') renderPane();
  } catch (e) { console.warn('inat', e); }
}

// ---------- Article ----------
function renderArticle() {
  const sp = state.sel;
  const body = $('#article-body');
  if (!sp) return renderHome();
  const g = GROUP[sp.group];
  const { direct, general } = sp.group ? camsFor(sp) : { direct: [], general: [] };
  const camCount = direct.length + general.length;
  body.innerHTML = `
    <div class="hero" id="hero"><button class="close" data-home aria-label="Close">✕</button></div>
    <div class="title">
      <h2>${esc(sp.name)}</h2>
      <div class="latin">${esc(sp.latin)}</div>
      <div class="badges">
        ${g ? `<span class="badge" style="border-color:${g.color};color:${g.color}">${g.glyph} ${esc(g.label)}</span>` : '<span class="badge">🌍 GBIF species</span>'}
        <span class="badge">${esc(sp.sub)}</span>
        ${sp.facts?.Status ? `<span class="badge">${esc(sp.facts.Status)}</span>` : ''}
      </div>
    </div>
    <nav class="tabs">
      ${[['overview', 'Overview'], ['pictures', 'Pictures'], ['map', 'Map'], ['live', 'Live video', camCount], ['studies', 'Studies']].map(([id, l, n]) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}
    </nav>
    <div class="pane" id="pane"></div>`;
  wikiFor(sp).then((w) => {
    if (state.sel !== sp) return;
    const img = w?.originalimage?.source || w?.thumbnail?.source;
    if (img) $('#hero').style.backgroundImage = `url("${img.replace(/"/g, '%22')}")`;
    if (state.tab === 'overview') renderPane();
  });
  renderPane();
  $('#article').hidden = false;
  window.WE_view?.('article');
}
$('#article').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { state.tab = t.dataset.tab; document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b === t)); renderPane(); }
  if (e.target.closest('[data-home]')) goHome();
  const seg = e.target.closest('[data-sort]');
  if (seg) { studySort = seg.dataset.sort; renderPane(); }
});

function factsHTML(f) {
  const rows = Object.entries(f || {}).filter(([, v]) => v);
  return rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
}
let studySort = 'cited';
const OA_KEY = (window.WILDLIFE_EYE_CONFIG || {}).openalexKey || '';
function renderPane() {
  const sp = state.sel;
  const pane = $('#pane');
  if (!pane || !sp) return;
  const tab = state.tab;
  if (tab === 'overview') {
    const w = sp.wiki;
    const rs = (sp.routes || []).map((r) => ROUTE[r]).filter(Boolean);
    const ex = sp.group ? W.extras[sp.group] : null;
    pane.innerHTML = `
      <h3>Encyclopedia</h3>
      ${w === undefined ? '<div class="loading">Reading Wikipedia…</div>' : w ? `<p>${esc(w.extract)}</p><a class="muted" target="_blank" rel="noopener" href="${esc(safeUrl(w.content_urls?.desktop?.page))}">Wikipedia: ${esc(w.title)} ↗ (CC BY-SA)</a>` : '<p class="muted">No Wikipedia article found.</p>'}
      ${sp.note ? `<h3>Field notes</h3><p>${esc(sp.note)}</p>` : ''}
      ${Object.keys(sp.facts || {}).length ? `<h3>Facts</h3>${factsHTML(sp.facts)}` : ''}
      ${rs.length ? `<h3>Migration routes</h3>${rs.map((r) => `<div class="card"><h5>${esc(r.name)}</h5>${factsHTML(r.facts)}${r.note ? `<p class="abstract">${esc(r.note)}</p>` : ''}<div class="actions"><button class="btn" data-route="${esc(r.id)}">Show on globe</button></div></div>`).join('')}` : ''}
      ${sp.native?.length ? `<h3>Native range · ${sp.native.length} countries</h3><div class="tags">${sp.native.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
      ${sp.lost?.length ? `<h3>Lost from</h3><div class="tags">${sp.lost.map((c) => `<span class="tag lost">${esc(c)}</span>`).join('')}</div>` : ''}
      ${sp.introduced?.length ? `<h3>Introduced to · ${sp.introduced.length} countries</h3><div class="tags">${sp.introduced.map((c) => `<span class="tag intro">${esc(c)}</span>`).join('')}</div>` : ''}
      ${ex?.records ? `<h3>${esc(GROUP[sp.group].label)} records</h3>${ex.records.map((r) => `<div class="card"><b class="mono" style="color:var(--accent)">${esc(r.v)}</b> ${esc(r.t)}<div class="meta">${esc(r.s)}</div></div>`).join('')}` : ''}
      ${ex?.lost ? `<h3>Lost ${esc(GROUP[sp.group].label.toLowerCase())}</h3>${ex.lost.map((l) => `<div class="card"><b>${esc(l.n)}</b> <span class="meta">${esc(l.y)}</span><div class="meta">${esc(l.t)}</div></div>`).join('')}` : ''}`;
  } else if (tab === 'pictures') {
    pane.innerHTML = `<h3>Wikimedia Commons</h3><div id="wm" class="loading">Loading pictures…</div><h3>Recent field photos · iNaturalist</h3><div id="inat-g" class="loading">Loading observations…</div>`;
    loadPictures(sp);
  } else if (tab === 'map') {
    const nRoutes = (sp.routes || []).length;
    pane.innerHTML = `
      <div class="stat-row">
        <div class="stat"><b id="occ">…</b><span>GBIF records</span></div>
        <div class="stat"><b>${sp.native?.length ?? '—'}</b><span>range countries</span></div>
        <div class="stat"><b>${nRoutes || '—'}</b><span>migration routes</span></div>
      </div>
      <h3>On the globe</h3>
      <div class="legend">
        ${sp.native ? `<div><span style="background:#5ef2c8"></span>Native range (atlas)</div>` : ''}
        ${sp.lost?.length ? `<div><span style="background:#ff4d5e"></span>Former range, now lost</div>` : ''}
        ${sp.introduced?.length ? `<div><span style="background:#ba68c8"></span>Introduced or invasive</div>` : ''}
        ${nRoutes ? `<div><span style="background:${GROUP[sp.group]?.color};height:3px"></span>Migration routes (dashed: partial, historical or one animal)</div>` : ''}
        <div><span style="background:linear-gradient(90deg,#5e2f8c,#f0e442)"></span>Observation density, every GBIF record (toggle in the top bar)</div>
        <div><span style="background:#5ef2c8;border-radius:50%;width:10px"></span>Recent research-grade sightings (iNaturalist)</div>
        ${sp.group ? `<div><span style="background:#ff4d5e;border-radius:50%;width:10px"></span>Live cameras</div>` : ''}
      </div>
      <div class="actions" style="margin:12px 0">
        ${sp.native ? '<button class="btn" id="fly-range">Fly to range</button>' : ''}
        <button class="btn" id="fly-sightings">Fly to sightings</button>
        <a class="btn" id="gbif-link" target="_blank" rel="noopener" href="https://www.gbif.org/species/search?q=${encodeURIComponent(cleanLatin(sp.latin))}">GBIF map ↗</a>
      </div>
      <h3>Latest sightings</h3>
      <div id="sightings">${sp.inat ? sightingsHTML(sp.inat.results.slice(0, 25)) : '<div class="loading">Loading sightings…</div>'}</div>`;
    $('#fly-range')?.addEventListener('click', () => flyToEntities(layers.ranges));
    $('#fly-sightings').addEventListener('click', () => viewer.flyTo(layers.sightings, { duration: 1.6 }));
    gbifKeyFor(sp).then(async (k) => {
      if (!k) { $('#occ').textContent = '—'; return; }
      $('#gbif-link').href = `https://www.gbif.org/species/${k}`;
      try { const c = await getJSON(`https://api.gbif.org/v1/occurrence/search?taxonKey=${k}&limit=0`); $('#occ').textContent = c.count.toLocaleString(); } catch { $('#occ').textContent = '—'; }
    });
  } else if (tab === 'live') {
    const { direct, general } = sp.group ? camsFor(sp) : { direct: [], general: [] };
    const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanName(sp.name) + ' live cam')}&sp=EgJAAQ%253D%253D`;
    const sorted = (l) => [...l].sort((a, b) => inSeason(b) - inSeason(a));
    pane.innerHTML = `
      ${direct.length ? `<h3>Cameras watching the ${esc(sp.name.toLowerCase())}</h3>${sorted(direct).map((c) => camHTML(c)).join('')}` : ''}
      ${general.length ? `<h3>${esc(GROUP[sp.group].label)} cameras &amp; stream directories</h3>${sorted(general).map((c) => camHTML(c)).join('')}` : ''}
      ${!direct.length && !general.length ? '<p class="muted">No atlas cameras for this animal yet.</p>' : ''}
      <h3>Find more live streams</h3>
      <div class="actions"><a class="btn live" target="_blank" rel="noopener" href="${esc(yt)}"><span class="livedot" style="background:#fff"></span> Live now on YouTube ↗</a>
      <a class="btn" target="_blank" rel="noopener" href="https://explore.org/livecams">explore.org live cams ↗</a></div>
      <h3>Live sightings · last reported</h3>
      <div>${sp.inat ? sightingsHTML(sp.inat.results.slice(0, 8)) : '<div class="loading">Loading…</div>'}</div>`;
  } else if (tab === 'studies') {
    pane.innerHTML = `<div class="seg"><button data-sort="cited" class="${studySort === 'cited' ? 'on' : ''}">Most cited</button><button data-sort="new" class="${studySort === 'new' ? 'on' : ''}">Newest</button></div>
      <div id="studies"><div class="loading">Searching the research literature…</div></div>
      <h3>Search further</h3>
      <div class="actions">
        <a class="btn" target="_blank" rel="noopener" href="https://scholar.google.com/scholar?q=${encodeURIComponent('"' + cleanLatin(sp.latin) + '"')}">Google Scholar ↗</a>
        <a class="btn" target="_blank" rel="noopener" href="https://europepmc.org/search?query=${encodeURIComponent('"' + cleanLatin(sp.latin) + '"')}">Europe PMC ↗</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.iucnredlist.org/search?query=${encodeURIComponent(cleanLatin(sp.latin))}">IUCN Red List ↗</a>
      </div>`;
    loadStudies(sp, studySort);
  }
}
function sightingsHTML(list) {
  if (!list.length) return '<p class="muted">No recent research-grade sightings.</p>';
  return list.map((o) => {
    const ph = o.photos?.[0]?.url;
    const ll = o.geojson?.coordinates;
    return `<div class="sighting" ${ll ? `data-fly="${ll[0]},${ll[1]},60000"` : ''}>${ph ? `<img src="${esc(ph)}" alt="" loading="lazy">` : ''}<div><b>${esc(o.place_guess || 'Unknown place')}</b>${esc(o.observed_on || '')} · ${esc(o.user?.login || '')}</div></div>`;
  }).join('');
}
function camHTML(c, compact) {
  const on = inSeason(c);
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const season = c.months === 'all' || !c.months ? 'Year-round' : c.months.map((m) => MN[m - 1]).join(' ');
  return `<div class="card"${compact ? ' style="margin:0;border:0;padding:0;background:none"' : ''}>
    <h5><span class="livedot"></span> ${esc(c.t)}</h5>
    <div class="meta">${esc(c.where || c.loc || '')}</div>
    <p class="abstract">${esc(c.p || '')}</p>
    <div class="season ${on ? 'on' : 'off'}">${on ? '● Animals usually present now' : '○ Off season now'} · ${esc(season)}</div>
    <div class="actions">
      <a class="btn live" target="_blank" rel="noopener" href="${esc(safeUrl(c.u))}">Watch live ↗</a>
      <button class="btn" data-embed="${esc(c.u)}" data-title="${esc(c.t)}">Open here</button>
      ${c.lon != null ? `<button class="btn" data-fly="${c.lon},${c.lat},250000">Fly to</button>` : ''}
    </div></div>`;
}
async function loadPictures(sp) {
  const w = await wikiFor(sp);
  const wm = $('#wm');
  if (w && wm) {
    try {
      const m = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(w.titles?.canonical || w.title)}`);
      const imgs = m.items.filter((i) => i.type === 'image' && i.showInGallery && i.srcset?.length && !/\.svg$/i.test(i.title));
      if ($('#wm')) {
        $('#wm').className = 'gallery';
        $('#wm').innerHTML = imgs.length ? imgs.slice(0, 24).map((i) => {
          const src = safeUrl(i.srcset[0].src);
          const big = safeUrl(i.srcset[i.srcset.length - 1].src);
          const cap = esc(i.caption?.text || i.title.replace(/^File:/, ''));
          return `<button data-img="${esc(big)}" data-title="${esc(sp.name)}" data-cap="${cap} · Wikimedia Commons" style="background-image:url('${esc(src)}')" aria-label="${cap}"></button>`;
        }).join('') : '<p class="muted">No pictures on Wikipedia.</p>';
      }
    } catch { if ($('#wm')) $('#wm').outerHTML = '<p class="muted">Could not load Wikimedia pictures.</p>'; }
  } else if (wm) wm.outerHTML = '<p class="muted">No Wikipedia article, so no Commons pictures.</p>';
  try {
    const j = sp.inat || (await inatFor(sp));
    const el = $('#inat-g');
    if (!el || state.sel !== sp) return;
    el.className = 'gallery';
    const photos = j.results.flatMap((o) => (o.photos || []).slice(0, 1).map((p) => ({ o, p }))).slice(0, 30);
    el.innerHTML = photos.length ? photos.map(({ o, p }) => {
      const cap = esc(`${o.place_guess || ''} · ${o.observed_on || ''} · ${p.attribution || ''}`);
      return `<button data-img="${esc(p.url.replace('square', 'large'))}" data-title="${esc(sp.name)}" data-cap="${cap}" style="background-image:url('${esc(p.url.replace('square', 'small'))}')" aria-label="${cap}"></button>`;
    }).join('') : '<p class="muted">No field photos.</p>';
  } catch { $('#inat-g') && ($('#inat-g').outerHTML = '<p class="muted">Could not reach iNaturalist.</p>'); }
}
async function loadStudies(sp, sort) {
  const term = cleanLatin(sp.latin) || cleanName(sp.name);
  const el = () => $('#studies');
  let works = [];
  let source = '';
  try {
    const order = sort === 'new' ? 'publication_date:desc' : 'cited_by_count:desc';
    const extra = sort === 'new' ? ',from_publication_date:2020-01-01' : '';
    const q = (field) => getJSON(`https://api.openalex.org/works?filter=${field}.search:${encodeURIComponent('"' + term + '"')}${extra}&sort=${order}${OA_KEY ? '&api_key=' + encodeURIComponent(OA_KEY) : ''}&per-page=15&select=id,display_name,publication_year,cited_by_count,doi,primary_location,authorships,abstract_inverted_index,open_access`);
    let j = await q('title');
    if (j.results.length < 5) {
      const more = await q('title_and_abstract');
      const ids = new Set(j.results.map((r) => r.id));
      j = { results: [...j.results, ...more.results.filter((r) => !ids.has(r.id))].slice(0, 15) };
    }
    works = j.results.map((r) => ({
      title: r.display_name, year: r.publication_year, cites: r.cited_by_count,
      venue: r.primary_location?.source?.display_name,
      authors: r.authorships.slice(0, 3).map((a) => a.author.display_name).join(', ') + (r.authorships.length > 3 ? ' et al.' : ''),
      abstract: invert(r.abstract_inverted_index),
      url: r.open_access?.oa_url || r.doi || r.id, oa: r.open_access?.is_oa,
    }));
    source = 'OpenAlex';
  } catch (e) { console.warn('openalex', e); }
  if (!works.length) {
    try {
      const ep = (query) => getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=15&resultType=core&sort=${sort === 'new' ? 'P_PDATE_D%20desc' : 'CITED%20desc'}`);
      let j = await ep(`TITLE:"${term}"`);
      if (j.resultList.result.length < 5) j = await ep(`"${term}"`);
      works = j.resultList.result.map((r) => ({
        title: r.title, year: r.pubYear, cites: r.citedByCount, venue: r.journalInfo?.journal?.title, authors: r.authorString,
        abstract: (r.abstractText || '').replace(/<[^>]+>/g, ''), url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`, oa: r.isOpenAccess === 'Y',
      }));
      source = 'Europe PMC';
    } catch (e) { console.warn('epmc', e); }
  }
  if (!el() || state.sel !== sp || state.tab !== 'studies') return;
  el().innerHTML = works.length ? works.map((w) => `<div class="card">
      <h5><a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener">${esc((w.title || '').replace(/<[^>]+>/g, ''))}</a></h5>
      <div class="meta">${esc(w.authors || '')}</div>
      <div class="meta">${esc(w.year || '')}${w.venue ? ' · ' + esc(w.venue) : ''} · cited ${Number(w.cites || 0).toLocaleString()}×${w.oa ? ' · <b style="color:var(--accent)">open access</b>' : ''}</div>
      ${w.abstract ? `<details><summary>Abstract</summary><div class="abstract">${esc(w.abstract)}</div></details>` : ''}
    </div>`).join('') + `<p class="muted">Source: ${source}.</p>` : '<p class="muted">No studies found, or the research services are busy. Try the links below.</p>';
}
function invert(ix) {
  if (!ix) return '';
  const words = [];
  for (const [w, ps] of Object.entries(ix)) for (const p of ps) words[p] = w;
  return words.join(' ');
}

// ---------- Home ----------
function renderHome() {
  const live = W.cams.filter(inSeason);
  $('#article-body').innerHTML = `<div class="pane">
    <h3>Welcome</h3>
    <p>A god's-eye view of the planet's wildlife. Pick an animal on the left, or search for any species on Earth. Every entry has an encyclopedia article, pictures, a live range map, live cameras and the research behind it.</p>
    <div class="stat-row">
      <div class="stat"><b>${W.species.length}</b><span>atlas species</span></div>
      <div class="stat"><b>${W.routes.length}</b><span>migration routes</span></div>
      <div class="stat"><b>${live.length}</b><span>cams in season</span></div>
    </div>
    <h3>Explore</h3>
    <div class="home-groups">${W.groups.map((g) => `<button data-group-home="${g.id}"><span class="g">${g.glyph}</span><b>${esc(g.label)}</b><small>${W.species.filter((s) => s.group === g.id).length} entries · ${W.cams.filter((c) => c.group === g.id).length} cams</small></button>`).join('')}</div>
    <h3><span class="livedot"></span> Live now · animals usually on camera this month</h3>
    ${live.filter((c) => c.lon != null).map((c) => camHTML(c)).join('')}
    <p class="muted">Atlas data built ${esc(W.built)}. Pictures and text from Wikipedia and Wikimedia Commons (CC BY-SA), sightings from iNaturalist, occurrence maps from GBIF, studies from OpenAlex and Europe PMC.</p>
  </div>`;
}
$('#article').addEventListener('click', (e) => {
  const g = e.target.closest('[data-group-home]');
  if (g) { state.group = g.dataset.groupHome; renderChips(); renderList(); showGroupOnGlobe(); }
});
function showGroupOnGlobe() {
  const inG = (gid) => state.group === 'all' || gid === state.group;
  drawRoutes(W.routes.filter((r) => inG(SPECIES[r.species].group)));
  if (inG('birds')) drawFlyways();
  drawCams(W.cams.filter((c) => inG(c.group)));
  drawRanges(null);
}
function goHome() {
  state.sel = null;
  state.gbifKey = null;
  history.replaceState(null, '', location.pathname);
  setDensity(null);
  layers.sightings.entities.removeAll();
  showGroupOnGlobe();
  renderList();
  renderHome();
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(-30, 25, homeHeight()), duration: 1.6 });
}

// ---------- Boot ----------
renderChips();
renderList();
showGroupOnGlobe();
renderHome();
if (location.hash.length > 1) select(decodeURIComponent(location.hash.slice(1)));
