#!/usr/bin/env node
/**
 * Build data/wild.js (window.WILD) for Wildlife Eye from the five atlas pages
 * in the home folder. Only each atlas's data block is evaluated, never its
 * rendering code.
 *
 * Camera map positions come from the God's Eye View wildlife layers
 * (~/Downloads/gods-eye-view/src/data/local_data/wildlife/*.geojsonl), matched by title.
 *
 * Usage: node scripts/build-data.mjs [--atlas-dir DIR] [--gev-dir DIR]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : d;
};
const HOME = flag('--atlas-dir', os.homedir());
const GEV = flag('--gev-dir', path.join(os.homedir(), 'Downloads/gods-eye-view'));

const scripts = (file) =>
  [...fs.readFileSync(path.join(HOME, file), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
function dataBlock(file, from, to, names) {
  const s = scripts(file);
  const js = s[s.length - 1];
  const a = js.indexOf(from);
  const b = js.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`markers not found in ${file}`);
  return new Function(`const addEventListener = () => {};\n${js.slice(a, b)}; return { ${names.join(', ')} };`)();
}

// ---- World countries (Natural Earth 110m via world-atlas, embedded in the bears atlas) ----
const world = new Function(`${scripts('bears-of-the-world.html').find((s) => s.trim().startsWith('const WORLD ='))}; return WORLD;`)();
function decode(topology, object) {
  const { scale, translate } = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [+(x * scale[0] + translate[0]).toFixed(2), +(y * scale[1] + translate[1]).toFixed(2)];
    });
  });
  const ring = (ix) => {
    const pts = [];
    for (const i of ix) {
      const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      pts.push(...(pts.length ? arc.slice(1) : arc));
    }
    return pts;
  };
  const out = {};
  for (const g of topology.objects[object].geometries) {
    const polys = g.type === 'Polygon' ? [g.arcs.map(ring)] : g.type === 'MultiPolygon' ? g.arcs.map((p) => p.map(ring)) : [];
    if (polys.length) out[g.properties.name] = polys.map((p) => p[0]); // outer rings only
  }
  return out;
}
const COUNTRIES = decode(world, 'countries');

// ---- Camera positions from the GEV wildlife layers ----
const CAMPOS = {};
const wdir = path.join(GEV, 'src/data/local_data/wildlife');
if (fs.existsSync(wdir)) {
  for (const f of fs.readdirSync(wdir).filter((f) => f.endsWith('.geojsonl'))) {
    for (const line of fs.readFileSync(path.join(wdir, f), 'utf8').split('\n').filter(Boolean)) {
      const ft = JSON.parse(line);
      const lv = ft.properties['Live video'];
      if (!lv) continue;
      for (const part of lv.split(' | ')) {
        const t = part.slice(0, part.indexOf(': http'));
        CAMPOS[t] = { c: ft.geometry.coordinates, loc: ft.properties.Location, approx: !!ft.properties['Map position'] };
      }
    }
  }
} else console.warn(`No GEV wildlife data at ${wdir}; cameras will have no map position.`);

const species = [];
const routes = [];
const cams = [];
const extras = {}; // per-group records / lost / notes
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));
function addCams(list, group, toSpecies) {
  for (const c of list) {
    const pos = CAMPOS[c.t];
    cams.push(clean({
      t: c.t, where: c.where, p: c.p, u: c.u, group, kind: c.k,
      months: c.m === 'all' ? 'all' : c.m,
      lon: pos?.c[0], lat: pos?.c[1], loc: pos?.loc, approx: pos?.approx || undefined,
      species: toSpecies(c),
    }));
  }
}

// ---- Whales ----
{
  const { SPECIES, ROUTES, CAMS, CONF } = dataBlock('whale-migration-atlas.html', 'const SPECIES', 'const OTHERS', ['SPECIES', 'ROUTES', 'CAMS', 'CONF']);
  const { OTHERS } = dataBlock('whale-migration-atlas.html', 'const OTHERS', 'const spColor', ['OTHERS']);
  for (const [k, s] of Object.entries(SPECIES)) {
    const rs = ROUTES.filter((r) => r.sp === k);
    species.push(clean({
      id: `whale-${k}`, group: 'whales', sub: 'Migratory whales',
      name: `${s.label} whale`.replace('Beluga whale', 'Beluga').replace('Narwhal whale', 'Narwhal'),
      latin: s.latin,
      facts: { 'Known routes': String(rs.length) },
      routes: rs.map((r) => r.id),
    }));
    for (const r of rs) routes.push(clean({
      id: r.id, species: `whale-${k}`, name: r.name, lines: r.p, dashed: r.d,
      facts: clean({ Population: r.pop, From: r.a, To: r.b, Distance: r.km, Timing: r.when, Abundance: r.abund, Status: r.status, Confidence: CONF[r.conf] }),
      note: r.note,
    }));
  }
  addCams(CAMS, 'whales', (c) => [...new Set((c.r || []).map((id) => ROUTES.find((r) => r.id === id)).filter(Boolean).map((r) => `whale-${r.sp}`))]);
  extras.whales = { others: OTHERS.map(([n, t]) => ({ n, t })) };
}

// ---- Birds ----
{
  const { GROUPS, FLYWAYS, ROUTES, CAMS, RECORDS } = dataBlock('bird-flyways-atlas.html', 'const GROUPS', 'const $ =', ['GROUPS', 'FLYWAYS', 'ROUTES', 'CAMS', 'RECORDS']);
  for (const r of ROUTES) {
    species.push(clean({
      id: `bird-${r.id}`, group: 'birds', sub: GROUPS[r.g].label, name: r.name, latin: r.latin,
      facts: clean({ 'Breeding ground': r.a, 'Wintering ground': r.b, Distance: r.km, Timing: r.when, Flyway: r.fly }),
      note: r.note, routes: [r.id],
    }));
    routes.push(clean({ id: r.id, species: `bird-${r.id}`, name: r.name, lines: r.p, dashed: r.d, facts: { Distance: r.km, Timing: r.when } }));
  }
  const kw = (c) => `${c.t} ${c.p}`.toLowerCase();
  addCams(CAMS, 'birds', (c) => ROUTES.filter((r) => {
    const last = r.name.toLowerCase().split(' ').pop().replace(/s$/, '');
    return kw(c).includes(last);
  }).map((r) => `bird-${r.id}`));
  extras.birds = { flyways: FLYWAYS.map((f) => ({ name: f.name, line: f.p, lab: f.lab, spp: f.spp, d: f.d })), records: RECORDS };
}

// ---- Bees, wasps & hornets ----
{
  const { R, GROUPS, TAXA, HOT, CAMS, BIOMES } = dataBlock('bees-wasps-hornets-atlas.html', 'const R =', '// ---------- Range resolution', ['R', 'GROUPS', 'TAXA', 'HOT', 'CAMS', 'BIOMES']);
  const expand = (list = []) => {
    const out = new Set();
    list.filter((x) => !x.startsWith('-')).forEach((x) => (x.startsWith('@') ? R[x.slice(1)].forEach((c) => out.add(c)) : out.add(x)));
    list.filter((x) => x.startsWith('-')).forEach((x) => out.delete(x.slice(1)));
    return out;
  };
  for (const t of TAXA) {
    const N = expand(t.n), I = expand(t.i);
    N.forEach((c) => I.delete(c));
    species.push(clean({
      id: `insect-${t.id}`, group: 'insects', sub: GROUPS[t.g].label, name: t.name, latin: t.latin,
      facts: clean({ Species: t.spp, Habitat: (t.hab || []).join(', '), Nest: t.nest, Social: t.social, Season: t.season }),
      note: t.note, native: [...N], introduced: [...I],
    }));
  }
  addCams(CAMS, 'insects', (c) => TAXA.filter((t) => t.g === c.g && /honey|apis/i.test(`${t.name} ${t.latin}`) && c.g === 'bees').map((t) => `insect-${t.id}`));
  extras.insects = { hotspots: HOT, biomes: BIOMES.map((b) => ({ h: b.h, p: b.p })) };
}

// ---- Wolves & bears ----
for (const [file, group, prefix] of [['wolves-of-the-world.html', 'wolves', 'wolf'], ['bears-of-the-world.html', 'bears', 'bear']]) {
  const { GROUPS, TAXA, CAMS, RECORDS, LOST } = dataBlock(file, 'const GROUPS', 'const $ =', ['GROUPS', 'TAXA', 'CAMS', 'RECORDS', 'LOST']);
  for (const t of TAXA) species.push(clean({
    id: `${prefix}-${t.id}`, group, sub: GROUPS[t.g].label, name: t.name, latin: t.latin,
    facts: clean({ Weight: t.wt, Look: t.look, Habitat: t.hab, Population: t.pop, Status: t.status }),
    note: t.note, native: t.n, lost: t.h,
  }));
  addCams(CAMS, group, (c) => (c.r || []).map((id) => `${prefix}-${id}`));
  extras[group] = { records: RECORDS, lost: LOST };
}

const GROUPS = [
  { id: 'whales', label: 'Whales', color: '#4fc3f7', glyph: '🐋' },
  { id: 'birds', label: 'Birds', color: '#ffd54f', glyph: '🦅' },
  { id: 'insects', label: 'Bees, wasps & hornets', color: '#ffb300', glyph: '🐝' },
  { id: 'wolves', label: 'Wolves', color: '#b0bec5', glyph: '🐺' },
  { id: 'bears', label: 'Bears', color: '#a1887f', glyph: '🐻' },
];
const out = { built: new Date().toISOString().slice(0, 10), groups: GROUPS, species, routes, cams, extras, countries: COUNTRIES };
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/wild.js'), `// Generated by scripts/build-data.mjs. Do not edit.\nwindow.WILD = ${JSON.stringify(out)};\n`);
const placed = cams.filter((c) => c.lon != null).length;
console.log(`species ${species.length}, routes ${routes.length}, cams ${cams.length} (${placed} on map), countries ${Object.keys(COUNTRIES).length}`);
