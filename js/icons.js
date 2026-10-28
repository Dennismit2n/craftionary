// Craftionary – Icons: Original-Texturen aus IndexedDB oder gut lesbare Ersatz-Kacheln

const DB_NAME = 'craftionary';
const DB_VER = 1;

function idb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB nicht verfügbar')); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('icons')) db.createObjectStore('icons');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqP(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

// Ersatzfarben aus dem Item-Namen (Material, Holzart, Farbe), damit Rezepte auch ohne Texturen lesbar sind
const COLORS = [
  ['light_blue', '#3aafd9'], ['light_gray', '#9d9d97'], ['dark_oak', '#4f3218'], ['pale_oak', '#e3d9d3'], ['red_sand', '#be6621'],
  ['white', '#e9ecec'], ['orange', '#f07613'], ['magenta', '#bd44b3'], ['yellow', '#f8c627'], ['lime', '#70b919'],
  ['pink', '#ed8dac'], ['gray', '#4e5559'], ['cyan', '#158991'], ['purple', '#792aac'], ['blue', '#35399d'],
  ['brown', '#724728'], ['green', '#546d1b'], ['black', '#1d1d21'], ['red', '#b02e26'],
  ['netherite', '#4a4142'], ['diamond', '#4ee2ec'], ['emerald', '#41f384'], ['gold', '#f5d35b'], ['iron', '#d8d8d8'],
  ['copper', '#c0704c'], ['lapis', '#2d5ac2'], ['redstone', '#c41e1e'], ['quartz', '#e8e2d6'], ['amethyst', '#9a5cc6'],
  ['coal', '#2f2f2f'], ['charcoal', '#3a3125'], ['obsidian', '#1f1a2b'], ['prismarine', '#63ab9e'], ['slime', '#7bc965'],
  ['honey', '#f5a623'], ['snow', '#f3f9f9'], ['ice', '#91b7f7'], ['glass', '#c6e3ef'], ['sand', '#dbd3a0'],
  ['clay', '#a0a7b2'], ['brick', '#966a5b'], ['nether', '#5b2b2b'], ['end_', '#dbdf9e'], ['purpur', '#a97ea9'],
  ['deepslate', '#4d4d52'], ['blackstone', '#2e282e'], ['tuff', '#6c6d66'], ['calcite', '#e0e1dd'], ['andesite', '#8a8a8e'],
  ['diorite', '#c8c8c8'], ['granite', '#9a6b55'], ['mud', '#5c4a3c'], ['resin', '#d9711f'], ['moss', '#5a7a2e'],
  ['oak', '#b8945f'], ['spruce', '#7a5a34'], ['birch', '#d7cb8d'], ['jungle', '#b88764'], ['acacia', '#ba6337'],
  ['mangrove', '#773934'], ['cherry', '#e2b2a5'], ['bamboo', '#d4c35a'], ['crimson', '#7e3a56'], ['warped', '#398382'],
  ['poplar', '#cdbf8a'], ['wool', '#e9ecec'], ['leather', '#a0653f'], ['paper', '#e8e8e0'], ['book', '#7b4c2c'],
  ['string', '#e5e5e5'], ['torch', '#f7d24c'], ['stick', '#7a5530'], ['apple', '#d62b2b'], ['bread', '#c9944a'],
  ['carrot', '#f19a28'], ['potato', '#d4b06a'], ['beef', '#c75a4f'], ['porkchop', '#e48b85'], ['mutton', '#c75a4f'],
  ['chicken', '#e8c9a0'], ['cod', '#c7956b'], ['salmon', '#e27458'], ['rabbit', '#c08f6a'], ['wheat', '#dcc86a'],
  ['sugar', '#f4f4f4'], ['egg', '#efe2c4'], ['milk', '#f6f6f6'], ['bone', '#e9e5d0'], ['gunpowder', '#5e5e5e'],
  ['blaze', '#f6b330'], ['ender', '#2c8a73'], ['ghast', '#e6e6e6'], ['feather', '#f2f2f2'], ['flint', '#3e3e3e'],
  ['stone', '#8a8a8a'], ['cobble', '#7a7a7a'], ['dirt', '#866043'], ['grass', '#6aa84f'], ['leaves', '#4a8a2a'],
];

function colorFor(id, potionColor) {
  if (potionColor != null) return '#' + potionColor.toString(16).padStart(6, '0');
  for (const [k, c] of COLORS) if (id.includes(k)) return c;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 35% 55%)`;
}

function readableInk(hex) {
  if (!hex.startsWith('#')) return '#101012';
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#141416' : '#fbfbfb';
}

export class Icons {
  constructor() {
    this.urls = new Map();
    this.meta = null;
    this.db = null;
    this.listeners = new Set();
  }

  get available() { return this.urls.size > 0; }

  async init() {
    try {
      this.db = await idb();
      this.meta = await tx(this.db, 'meta', 'readonly', (s) => reqP(s.get('textures')));
      if (this.meta) await this.#loadAll();
    } catch (e) {
      console.warn('[icons] IndexedDB nicht nutzbar:', e);
    }
  }

  async #loadAll() {
    const entries = await tx(this.db, 'icons', 'readonly', async (s) => {
      const [keys, vals] = await Promise.all([reqP(s.getAllKeys()), reqP(s.getAll())]);
      return keys.map((k, i) => [k, vals[i]]);
    });
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    for (const [k, blob] of entries) this.urls.set(k, URL.createObjectURL(blob));
  }

  async save(map, meta) {
    if (!this.db) this.db = await idb();
    await tx(this.db, 'icons', 'readwrite', (s) => { s.clear(); for (const [k, b] of map) s.put(b, k); });
    await tx(this.db, 'meta', 'readwrite', (s) => s.put(meta, 'textures'));
    this.meta = meta;
    await this.#loadAll();
    this.emit();
  }

  async clear() {
    if (!this.db) return;
    await tx(this.db, 'icons', 'readwrite', (s) => s.clear());
    await tx(this.db, 'meta', 'readwrite', (s) => s.delete('textures'));
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.meta = null;
    this.emit();
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  url(id) { return this.urls.get(id) || null; }

  /**
   * Icon-Element. opts.letter: Buchstabe für Ersatz-Kachel (Legende), opts.label: Text für Screenreader,
   * opts.potionColor: Trankfarbe, opts.initials: Kürzel, wenn kein Buchstabe vergeben ist.
   */
  el(id, opts = {}) {
    const url = this.url(id);
    const span = document.createElement('span');
    span.className = 'ico';
    span.dataset.id = id;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = opts.label || '';
      img.draggable = false;
      img.decoding = 'async';
      span.append(img);
      span.classList.add('ico--tex');
    } else {
      const bg = colorFor(id, opts.potionColor);
      span.classList.add('ico--fb');
      span.style.setProperty('--fb', bg);
      span.style.setProperty('--fb-ink', readableInk(bg));
      span.textContent = opts.letter || opts.initials || '';
      if (opts.letter) span.classList.add('ico--letter');
      if (opts.label) span.setAttribute('aria-label', opts.label);
      else span.setAttribute('aria-hidden', 'true');
    }
    return span;
  }
}

export function initialsOf(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
