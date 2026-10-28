// Craftionary – DOM-Bausteine: Spielfenster (Stationen), Slots, Legende, Hinweise

import { STATION_BY_ID } from './db.js';
import { t, getLang, numberFmt } from './i18n.js';
import { initialsOf } from './icons.js';

/** Kinder ersetzen und dabei leere Werte (null/false) auslassen */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

/** Mini-Hyperscript */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// --------------------------------------------------------------------------- Pixelgrafiken (eigene)
const PIX = {
  arrow: [
    '..............x.......',
    '..............xx......',
    '..............xxx.....',
    '..............xxxx....',
    '..............xxxxx...',
    'xxxxxxxxxxxxxxxxxxxx..',
    'xxxxxxxxxxxxxxxxxxxxx.',
    'xxxxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxxxxxxx.',
    'xxxxxxxxxxxxxxxxxxxx..',
    '..............xxxxx...',
    '..............xxxx....',
    '..............xxx.....',
    '..............xx......',
    '..............x.......',
  ],
  flame: [
    '......y.......',
    '.....yy.......',
    '.....yoy......',
    '....yooy..y...',
    '...yoooy.yy...',
    '...yooooyoy...',
    '..yoorooooy...',
    '..yorrrooooy..',
    '.yoorrrrrooy..',
    '.yorrrrrrroy..',
    '.yorrrrrrrooy.',
    '..yorrrrrroy..',
    '...yoorrooy...',
    '....yyyyyy....',
  ],
  bubbles: [
    '...x.....x.',
    '.x...x.....',
    '.....x...x.',
    '..x......x.',
    'x....x.x...',
    '...x.....x.',
    '.x.....x...',
  ],
};

const pixCache = new Map();
export function pix(name, color = '#8b8b8b', scale = 1) {
  const key = `${name}|${color}|${scale}`;
  if (pixCache.has(key)) return pixCache.get(key);
  const rows = PIX[name];
  const c = document.createElement('canvas');
  c.width = rows[0].length * scale;
  c.height = rows.length * scale;
  const ctx = c.getContext('2d');
  const pal = { x: color, y: '#ffd54a', o: '#f39c32', r: '#d8471f' };
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    ctx.fillStyle = pal[ch] || color;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }));
  const url = c.toDataURL();
  pixCache.set(key, url);
  return url;
}

// --------------------------------------------------------------------------- Kontext für ein Rezept
/**
 * Hält Buchstaben-Zuordnung (Legende) und Zyklus-Registrierung für ein Rezept-Fenster.
 */
export class Ctx {
  constructor(app, { qty = 1, letters = true } = {}) {
    this.app = app;
    this.db = app.db;
    this.icons = app.icons;
    this.qty = qty;
    this.letterMap = new Map();
    this.letters = letters;
  }

  keyOf(ref) { return Array.isArray(ref) ? ref.join('|') : ref; }

  letter(ref) {
    if (!this.letters || ref == null) return null;
    const k = this.keyOf(ref);
    if (!this.letterMap.has(k)) this.letterMap.set(k, { ref, letter: String.fromCharCode(65 + this.letterMap.size) });
    return this.letterMap.get(k).letter;
  }

  /** Slot mit Zutat (zyklisch bei Tags), optional Anzahl */
  slot(ref, { big = false, count = null, empty = false, kind = '', label = null, letter = true, onClick = null } = {}) {
    const el = h('div', { class: `slot${big ? ' slot--big' : ''}${kind ? ' slot--' + kind : ''}` });
    if (ref == null || empty) {
      if (label) el.setAttribute('aria-label', label);
      if (onClick) { el.classList.add('slot--btn'); el.tabIndex = 0; el.setAttribute('role', 'button'); el.addEventListener('click', onClick); }
      return el;
    }
    const items = this.db.ingItems(ref);
    const L = letter ? this.letter(ref) : null;
    const render = (i) => {
      const id = items[i % items.length];
      const it = this.db.items[id];
      const pc = it && it.potion ? (this.db.potions[it.potion]?.color ?? this.db.meta.defaultPotionColor) : null;
      const ico = this.icons.el(id, { letter: L, initials: L ? null : initialsOf(this.db.name(id, getLang())), potionColor: pc, label: this.db.name(id, getLang()) });
      el.replaceChildren(ico);
      if (count != null && count > 1) el.append(h('span', { class: 'cnt' }, count));
      el.dataset.tip = id;
      if (items.length > 1) el.dataset.multi = this.db.ingLabel(ref, getLang());
      else delete el.dataset.multi;
    };
    render(0);
    if (items.length > 1) this.app.addCycler(render);
    el.classList.add('slot--item');
    el.tabIndex = 0;
    el.setAttribute('role', 'link');
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (onClick) { onClick(ev); return; }
      this.app.openItem(el.dataset.tip);
    });
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') el.click(); });
    return el;
  }

  result(out, { count = null } = {}) {
    if (!out) return this.slot(null, { big: true });
    return this.slot(out.id, { big: true, count: count ?? out.n, letter: false, kind: 'result' });
  }
}

// --------------------------------------------------------------------------- Fenster
function guiFrame(title, body, extraClass = '') {
  return h('div', { class: `gui ${extraClass}` },
    h('div', { class: 'gui-title' }, title),
    body);
}

export function arrow({ progress = null } = {}) {
  const el = h('div', { class: 'gui-arrow', 'aria-hidden': 'true' });
  el.style.setProperty('--arrow', `url(${pix('arrow', '#8b8b8b')})`);
  el.style.setProperty('--arrow-fill', `url(${pix('arrow', '#ffffff')})`);
  if (progress) { el.classList.add('gui-arrow--run'); el.style.setProperty('--dur', progress + 's'); }
  return el;
}

function flame(lit = true, dur = 10) {
  const el = h('div', { class: `gui-flame${lit ? ' gui-flame--lit' : ''}`, 'aria-hidden': 'true' });
  el.style.setProperty('--flame', `url(${pix('flame')})`);
  el.style.setProperty('--flame-off', `url(${pix('flame', '#6f6f6f')})`);
  el.style.setProperty('--dur', dur + 's');
  return el;
}

export function stationTitle(db, stId) {
  const st = STATION_BY_ID[stId];
  const li = getLang() === 'de' ? 1 : 0;
  if (stId === 'inventory') return (db.ui['container.crafting'] || ['Crafting', 'Handwerk'])[li];
  const k = st.title;
  return (db.ui[k] || [k, k])[li];
}

export function stationName(db, stId) {
  if (stId === 'inventory') return t('inventory');
  const st = STATION_BY_ID[stId];
  const li = getLang() === 'de' ? 1 : 0;
  return (db.ui[st.name] || [stId, stId])[li];
}

/** Werkbank 3×3 bzw. Inventar 2×2 */
export function craftingGui(ctx, r, { grid = 3, qty = 1, plan = null, cells = null } = {}) {
  const db = ctx.db;
  const layout = cells || db.layout(r, grid) || new Array(grid * grid).fill(null);
  const per = plan ? plan.perSlot : 1;
  const g = h('div', { class: 'gui-grid', style: { '--n': grid } },
    layout.map((ref) => ctx.slot(ref, { count: ref ? per : null })));
  const out = r ? ctx.result(r.out, { count: plan ? (r.out ? r.out.n * plan.crafts : null) : null }) : ctx.slot(null, { big: true });
  return guiFrame(stationTitle(db, grid === 2 ? 'inventory' : 'crafting'),
    h('div', { class: 'gui-row' }, g, arrow(), out), `gui--craft gui--g${grid}`);
}

/** Ofen, Schmelzofen, Räucherofen */
export function furnaceGui(ctx, r, { plan = null, fuelId = 'coal' } = {}) {
  const sec = r.time / 20;
  const inCount = plan ? plan.crafts : null;
  const fuel = plan ? ctx.db.fuelFor(r, fuelId, plan.crafts) : null;
  const left = h('div', { class: 'furnace-col' },
    ctx.slot(r.in, { count: inCount }),
    flame(true, sec * 8),
    ctx.slot(fuelId, { count: fuel ? fuel.count : null, letter: false, kind: 'fuel' }));
  return guiFrame(stationTitle(ctx.db, r.station),
    h('div', { class: 'gui-row' }, left, arrow({ progress: sec }), ctx.result(r.out, { count: plan ? r.out.n * plan.crafts : null })),
    'gui--furnace');
}

/** Lagerfeuer (im Spiel ohne Fenster – hier als Schaubild) */
export function campfireGui(ctx, r, { plan = null } = {}) {
  const four = h('div', { class: 'campfire-slots' }, [0, 1, 2, 3].map((i) => (i === 0 ? ctx.slot(r.in, { count: plan ? plan.crafts : null }) : ctx.slot(null))));
  return guiFrame(stationTitle(ctx.db, 'campfire'),
    h('div', { class: 'gui-row' },
      h('div', { class: 'campfire-col' }, four, flame(true, 4)),
      arrow({ progress: r.time / 20 }),
      ctx.result(r.out, { count: plan ? r.out.n * plan.crafts : null })),
    'gui--campfire');
}

/** Steinsäge: Eingabe, Auswahlliste aller Ergebnisse, Ausgabe */
export function stonecutterGui(ctx, r, { plan = null, onPick = null } = {}) {
  const db = ctx.db;
  const inputId = db.ingItems(r.in)[0];
  const options = db.matchSingleInput('stonecutter', inputId);
  const list = h('div', { class: 'sc-list', role: 'listbox', 'aria-label': t('stonecutterAll', { item: db.name(inputId, getLang()) }) },
    options.map((o) => {
      const b = h('button', { class: `sc-opt${o === r ? ' is-sel' : ''}`, type: 'button', role: 'option', 'aria-selected': o === r ? 'true' : 'false', dataset: { tip: o.out.id } },
        ctx.icons.el(o.out.id, { initials: initialsOf(db.name(o.out.id, getLang())), label: db.name(o.out.id, getLang()) }));
      if (o.out.n > 1) b.append(h('span', { class: 'cnt' }, o.out.n));
      b.addEventListener('click', () => (onPick ? onPick(o) : ctx.app.openItem(o.out.id)));
      return b;
    }));
  return guiFrame(stationTitle(db, 'stonecutter'),
    h('div', { class: 'gui-row gui-row--sc' },
      ctx.slot(r.in, { count: plan ? plan.crafts : null }),
      list,
      ctx.result(r.out, { count: plan ? r.out.n * plan.crafts : null })),
    'gui--stonecutter');
}

/** Schmiedetisch: Vorlage, Gegenstand, Material → Ergebnis */
export function smithingGui(ctx, r, { plan = null } = {}) {
  const n = plan ? plan.crafts : null;
  const out = r.t === 'trim' ? ctx.slot(r.b, { big: true, letter: false, kind: 'result' }) : ctx.result(r.out, { count: n });
  return guiFrame(stationTitle(ctx.db, 'smithing'),
    h('div', { class: 'gui-row' },
      h('div', { class: 'smith-slots' }, ctx.slot(r.tpl, { count: n }), ctx.slot(r.b, { count: n }), ctx.slot(r.a, { count: n })),
      arrow(),
      out),
    'gui--smithing');
}

/** Braustand: Lohenstaub, Zutat, drei Flaschen → Ergebnis */
export function brewingGui(ctx, r, { plan = null } = {}) {
  const brews = plan ? plan.brews : 1;
  const bottles = plan ? Math.min(3, plan.qty) : 3;
  const bub = h('div', { class: 'brew-bubbles', 'aria-hidden': 'true' });
  bub.style.setProperty('--bub', `url(${pix('bubbles', '#d6e6ff')})`);
  const stand = h('div', { class: 'brew-stand' },
    h('div', { class: 'brew-top' },
      ctx.slot('blaze_powder', { letter: false, kind: 'fuel', count: plan ? plan.blaze : null }),
      bub,
      ctx.slot(r.re, { count: plan ? brews : null })),
    h('div', { class: 'brew-bottles' }, [0, 1, 2].map((i) => (i < bottles ? ctx.slot(r.in) : ctx.slot(null, { kind: 'bottle' })))));
  return guiFrame(stationTitle(ctx.db, 'brewing'),
    h('div', { class: 'gui-row' }, stand, arrow({ progress: 20 }), ctx.result(r.out, { count: plan ? plan.qty : 3 })),
    'gui--brewing');
}

/** Passendes Fenster für ein Rezept */
export function recipeGui(ctx, r, opts = {}) {
  switch (r.station) {
    case 'crafting': return craftingGui(ctx, r, { ...opts, grid: opts.grid || 3 });
    case 'furnace': case 'blast_furnace': case 'smoker': return furnaceGui(ctx, r, opts);
    case 'campfire': return campfireGui(ctx, r, opts);
    case 'stonecutter': return stonecutterGui(ctx, r, opts);
    case 'smithing': return smithingGui(ctx, r, opts);
    case 'brewing': return brewingGui(ctx, r, opts);
    default: return h('div');
  }
}

// --------------------------------------------------------------------------- Legende & Hinweise
export function legend(ctx, r, plan) {
  const db = ctx.db;
  const lang = getLang();
  const rows = [];
  const counts = new Map();
  if (plan) for (const e of plan.ingredients) counts.set(ctx.keyOf(e.ref), e.count);
  else for (const e of db.ingredientsOf(r)) counts.set(ctx.keyOf(e.ref), e.count);
  // Reihenfolge: nach vergebenen Buchstaben, dann übrige Zutaten
  const refs = [...ctx.letterMap.values()].map((v) => v.ref);
  for (const e of db.ingredientsOf(r)) if (!refs.some((x) => ctx.keyOf(x) === ctx.keyOf(e.ref))) refs.push(e.ref);
  for (const ref of refs) {
    const items = db.ingItems(ref);
    const L = ctx.letter(ref);
    const first = items[0];
    const it = db.items[first];
    const pc = it && it.potion ? (db.potions[it.potion]?.color ?? db.meta.defaultPotionColor) : null;
    const row = h('li', { class: 'lg-row' },
      h('span', { class: 'lg-ico' }, ctx.icons.el(first, { letter: L, potionColor: pc, label: db.name(first, lang) })),
      h('span', { class: 'lg-name' },
        h('button', { class: 'linkish', type: 'button', onClick: () => ctx.app.openItem(first) }, db.ingLabel(ref, lang)),
        items.length > 1 ? h('span', { class: 'lg-var' }, t('variants', { n: items.length })) : null),
      h('span', { class: 'lg-count' }, '×', numberFmt(counts.get(ctx.keyOf(ref)) || 1)));
    if (items.length > 1) {
      const det = h('details', { class: 'lg-more' },
        h('summary', null, t('any')),
        h('div', { class: 'lg-chips' }, items.map((id) => h('button', { class: 'chip chip--item', type: 'button', onClick: () => ctx.app.openItem(id), dataset: { tip: id } },
          ctx.icons.el(id, { initials: initialsOf(db.name(id, lang)) }), db.name(id, lang)))));
      row.append(det);
    }
    rows.push(row);
  }
  return h('ul', { class: 'legend', 'aria-label': 'Legende' }, rows);
}

export function chip(text, kind = '') {
  return h('span', { class: `chip${kind ? ' chip--' + kind : ''}` }, text);
}

export function fmtSeconds(sec) {
  if (sec < 60) return t('seconds', { n: numberFmt(sec, 1) });
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return t('minutes', { m, s: String(s).padStart(2, '0') });
}

export function fmtTicks(ticks) {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Hinweis-Chips für ein Rezept */
export function notes(ctx, r, { grid = 3, plan = null } = {}) {
  const db = ctx.db;
  const out = [];
  const special = t('special');
  switch (r.t) {
    case 'shaped':
      out.push(chip(t('shaped')));
      if (r.mirror) out.push(chip(t('mirror')));
      break;
    case 'shapeless': out.push(chip(t('shapeless'))); break;
    case 'transmute': out.push(chip(r.add ? special.transmuteMap : special.transmute, 'info')); break;
    case 'dye': out.push(chip(special.dye, 'info')); break;
    case 'imbue': out.push(chip(special.imbue, 'info')); break;
    case 'pot': out.push(chip(special.pot, 'info')); break;
    case 'banner_copy': out.push(chip(special.bannerCopy, 'info')); break;
    case 'book_copy': out.push(chip(special.bookCopy, 'info')); break;
    case 'rocket': out.push(chip(special.rocket, 'info')); break;
    case 'star': {
      const shapes = Object.keys(r.shapes).map((k) => t('shapes.' + k)).join(', ');
      out.push(chip(t('special.star', { shapes }), 'info'));
      break;
    }
    case 'star_fade': out.push(chip(special.starFade, 'info')); break;
    case 'map_extend': out.push(chip(special.mapExtend, 'info')); break;
    case 'shield_deco': out.push(chip(special.shield, 'info')); break;
    case 'smithing': out.push(chip(t('upgradeNote'), 'info')); break;
    case 'trim': out.push(chip(t('trimNote'), 'info')); break;
    case 'campfire': out.push(chip(t('campfireNote'), 'info')); break;
    case 'brewing': out.push(chip(t('brewUpTo3'), 'info')); break;
    case 'stonecutting': out.push(chip(t('stonecutterNote'))); break;
    default: break;
  }
  if (r.station === 'crafting' && grid === 3 && r.grid) out.push(chip(r.fits2 ? t('fits2x2') : t('needsTable'), r.fits2 ? 'good' : ''));
  if (['smelting', 'blasting', 'smoking', 'campfire'].includes(r.t)) {
    out.push(chip(`${t('time')}: ${t('timeEach', { s: fmtSeconds(r.time / 20) })}`));
    if (r.xp) out.push(chip(`${t('xp')}: ${numberFmt(r.xp, 2)}${plan && plan.crafts > 1 ? ' · ' + t('xpTotal', { x: numberFmt(plan.xp, 1) }) : ''}`));
  }
  if (r.out && r.out.extra && r.out.extra.stew) {
    const lang = getLang();
    for (const [eid, dur] of r.out.extra.stew) {
      const e = db.effects[eid];
      out.push(chip(`${t('effects')}: ${e ? e.n[lang === 'de' ? 1 : 0] : eid} (${fmtSeconds(dur / 20)})`, 'info'));
    }
  }
  return out.length ? h('div', { class: 'notes' }, out) : null;
}
