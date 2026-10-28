// Craftionary – Datenbank & Rezeptlogik (ohne DOM, testbar in Node)

export const STATIONS = [
  { id: 'crafting', block: 'crafting_table', title: 'container.crafting', name: 'block.minecraft.crafting_table', grid: 3 },
  { id: 'inventory', block: null, title: 'container.crafting', name: null, grid: 2 },
  { id: 'furnace', block: 'furnace', title: 'container.furnace', name: 'block.minecraft.furnace', kind: 'furnace' },
  { id: 'blast_furnace', block: 'blast_furnace', title: 'container.blast_furnace', name: 'block.minecraft.blast_furnace', kind: 'furnace', fast: true },
  { id: 'smoker', block: 'smoker', title: 'container.smoker', name: 'block.minecraft.smoker', kind: 'furnace', fast: true },
  { id: 'campfire', block: 'campfire', title: 'block.minecraft.campfire', name: 'block.minecraft.campfire', kind: 'campfire' },
  { id: 'stonecutter', block: 'stonecutter', title: 'container.stonecutter', name: 'block.minecraft.stonecutter', kind: 'stonecutter' },
  { id: 'smithing', block: 'smithing_table', title: 'container.upgrade', name: 'block.minecraft.smithing_table', kind: 'smithing' },
  { id: 'brewing', block: 'brewing_stand', title: 'container.brewing', name: 'block.minecraft.brewing_stand', kind: 'brewing' },
];
export const STATION_BY_ID = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

const CRAFT_TYPES = new Set(['shaped', 'shapeless', 'transmute', 'dye', 'imbue', 'pot', 'banner_copy', 'book_copy',
  'rocket', 'star', 'star_fade', 'map_extend', 'repair', 'shield_deco']);
const TYPE_STATION = { smelting: 'furnace', blasting: 'blast_furnace', smoking: 'smoker', campfire: 'campfire',
  stonecutting: 'stonecutter', smithing: 'smithing', trim: 'smithing', brewing: 'brewing' };

/**
 * Platziert Zutaten im Raster genau wie das Rezeptbuch im Spiel
 * (net.minecraft.recipebook.PlaceRecipeHelper.placeRecipe):
 * schmale Rezepte (Breite/Höhe < halbes Raster) werden mittig gesetzt, sonst oben links.
 */
export function placeRecipe(gridW, gridH, w, h, cells) {
  const out = new Array(gridW * gridH).fill(null);
  let it = 0;
  let i = 0;
  for (let j = 0; j < gridH; j++) {
    if (h < gridH / 2 && Math.floor(gridH / 2 - h / 2) > j) {
      i += gridW;
      j++;
    }
    for (let l = 0; l < gridW; l++) {
      if (it >= cells.length) return out;
      let end = w;
      let inside = l < w;
      if (w < gridW / 2) {
        const k = Math.floor(gridW / 2 - w / 2);
        end = k + w;
        inside = k <= l && l < k + w;
      }
      if (inside) {
        out[i] = cells[it++];
      } else if (end === l) {
        i += gridW - l;
        break;
      }
      i++;
    }
  }
  return out;
}

function refKey(ref) {
  return Array.isArray(ref) ? ref.join('|') : ref;
}

export class DB {
  constructor(data) {
    this.data = data;
    this.meta = data.meta;
    this.items = data.items;
    this.tags = data.tags;
    this.tagNames = data.tagNames || {};
    this.ui = data.ui || {};
    this.effects = data.effects || {};
    this.potions = data.potions || {};
    this.recipes = data.recipes;
    this.byOutput = new Map();
    this.byInput = new Map();
    this.byStation = new Map(STATIONS.map((s) => [s.id, []]));
    this.repairable = new Set();
    for (const r of this.recipes) this.#prepare(r);
    for (const [id, it] of Object.entries(this.items)) if (it.dmg) this.repairable.add(id);
  }

  // ---------------------------------------------------------------- Zutaten
  ingItems(ref) {
    if (ref == null) return [];
    if (Array.isArray(ref)) return ref;
    if (ref.startsWith('#')) return this.tags[ref.slice(1)] || [];
    return [ref];
  }

  ingLabel(ref, lang) {
    const li = lang === 'de' ? 1 : 0;
    if (Array.isArray(ref)) {
      const names = ref.map((id) => this.name(id, lang));
      return names.length <= 3 ? names.join(lang === 'de' ? ' oder ' : ' or ') : names.slice(0, 2).join(', ') + ' …';
    }
    if (ref.startsWith('#')) {
      const tn = this.tagNames[ref.slice(1)];
      return tn ? tn[li] : ref;
    }
    return this.fullName(ref, lang);
  }

  name(id, lang) {
    const it = this.items[id];
    if (!it) return id;
    return it.n[lang === 'de' ? 1 : 0];
  }

  sub(id, lang) {
    const it = this.items[id];
    return it && it.sub ? it.sub[lang === 'de' ? 1 : 0] : '';
  }

  /** Anzeige-Name inkl. Untertitel bzw. Trank-Stufe, damit gleichnamige Items unterscheidbar sind */
  fullName(id, lang) {
    const base = this.name(id, lang);
    const sub = this.sub(id, lang) || this.potionTag(id, lang);
    return sub ? `${base} – ${sub}` : base;
  }

  /** Kurzform wie im Tooltip des Spiels: Stufe und Dauer der ersten Wirkung, z. B. „II · 1:30“ oder „8:00“ */
  potionTag(id, lang) {
    const p = this.potionInfo(id);
    if (!p || !p.effects.length) return '';
    const e = p.effects[0];
    const lvl = e.amp > 0 ? (this.ui['potion.potency.' + e.amp] || ['', ''])[lang === 'de' ? 1 : 0] : '';
    let dur = '';
    if (!e.instant) {
      const sec = Math.floor(e.ticks / 20);
      dur = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    }
    return [lvl, dur].filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------------- Vorbereitung
  #prepare(r) {
    r.station = CRAFT_TYPES.has(r.t) ? 'crafting' : TYPE_STATION[r.t];
    if (r.o) r.out = { id: r.o[0], n: r.o[1], extra: r.o[2] || null };
    if (r.station === 'crafting') {
      const g = this.#craftGrid(r);
      if (g) {
        r.grid = g;
        r.fits2 = g.shaped ? g.w <= 2 && g.h <= 2 : g.cells.length <= 4;
        if (g.shaped) r.mirror = !isSymmetric(g);
      }
    }
    if (r.station) {
      this.byStation.get(r.station).push(r);
      if (r.fits2) this.byStation.get('inventory').push(r);
    }
    if (r.out && r.t !== 'repair') push(this.byOutput, r.out.id, r);
    for (const [ref, role] of this.roles(r)) {
      for (const id of this.ingItems(ref)) push(this.byInput, id, { r, role }, (a) => a.r === r);
    }
  }

  #craftGrid(r) {
    const S = (cells) => ({ shaped: false, w: 0, h: 0, cells });
    switch (r.t) {
      case 'shaped': {
        const h = r.p.length, w = r.p[0].length;
        const cells = [];
        for (const row of r.p) for (const ch of row) cells.push(ch === ' ' ? null : r.k[ch]);
        return { shaped: true, w, h, cells };
      }
      case 'shapeless': return S(r.i);
      case 'transmute': return S([r.in, r.m]);
      case 'dye': return S([r.tg, r.dye]);
      case 'imbue': return { shaped: true, w: 3, h: 3, cells: [r.m, r.m, r.m, r.m, r.src, r.m, r.m, r.m, r.m] };
      case 'pot': return { shaped: true, w: 3, h: 3, cells: [null, r.back, null, r.left, null, r.right, null, r.front, null] };
      case 'banner_copy': return S([r.b, r.b]);
      case 'book_copy': return S([r.src, r.m]);
      case 'rocket': return S([r.shell, r.fuel]);
      case 'star': return S([r.fuel, r.dye]);
      case 'star_fade': return S([r.tg, r.dye]);
      case 'map_extend': return { shaped: true, w: 3, h: 3, cells: [r.m, r.m, r.m, r.m, r.map, r.m, r.m, r.m, r.m] };
      case 'shield_deco': return S([r.tg, r.b]);
      default: return null;
    }
  }

  /** Liste [Zutat, Rolle] eines Rezepts */
  roles(r) {
    const out = [];
    const add = (ref, role) => { if (ref != null) out.push([ref, role]); };
    if (r.grid) for (const c of r.grid.cells) add(c, 'input');
    switch (r.t) {
      case 'smelting': case 'blasting': case 'smoking': case 'campfire': case 'stonecutting': add(r.in, 'input'); break;
      case 'smithing': case 'trim': add(r.tpl, 'template'); add(r.b, 'basepiece'); add(r.a, 'addition'); break;
      case 'brewing': add(r.in, 'base'); add(r.re, 'reagent'); break;
      case 'star':
        for (const v of Object.values(r.shapes)) add(v, 'input');
        add(r.trail, 'input'); add(r.twinkle, 'input');
        break;
      case 'rocket': add(r.star, 'input'); break;
      default: break;
    }
    // doppelte Einträge (gleiche Zutat mehrfach im Raster) zusammenfassen
    const seen = new Set();
    return out.filter(([ref, role]) => {
      const k = refKey(ref) + '@' + role;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ---------------------------------------------------------------- Abfragen
  recipesFor(id) {
    const list = this.byOutput.get(id) || [];
    const order = Object.fromEntries(STATIONS.map((s, i) => [s.id, i]));
    return [...list].sort((a, b) => order[a.station] - order[b.station]);
  }

  usagesOf(id) {
    return this.byInput.get(id) || [];
  }

  stationsFor(id) {
    const s = new Set(this.recipesFor(id).map((r) => r.station));
    if (this.recipesFor(id).some((r) => r.fits2)) s.add('inventory');
    return s;
  }

  /** Raster für die Anzeige: Vanilla-Platzierung in 3×3 bzw. 2×2 */
  layout(r, gridSize = 3) {
    const g = r.grid;
    if (!g) return null;
    if (g.shaped) return placeRecipe(gridSize, gridSize, g.w, g.h, g.cells);
    return placeRecipe(gridSize, gridSize, gridSize, gridSize, g.cells);
  }

  /** Zutaten eines Rezepts zusammengefasst: [{ref, count}] (pro Herstellung) */
  ingredientsOf(r) {
    const map = new Map();
    const add = (ref, n = 1) => {
      if (ref == null) return;
      const k = refKey(ref);
      const e = map.get(k);
      if (e) e.count += n; else map.set(k, { ref, count: n });
    };
    if (r.grid) for (const c of r.grid.cells) add(c);
    else if (['smelting', 'blasting', 'smoking', 'campfire', 'stonecutting'].includes(r.t)) add(r.in);
    else if (r.t === 'smithing' || r.t === 'trim') { add(r.tpl); add(r.b); add(r.a); }
    else if (r.t === 'brewing') { add(r.in); add(r.re); }
    return [...map.values()];
  }

  // ---------------------------------------------------------------- Mengen
  /** Wie oft muss ich craften, was bleibt übrig? */
  plan(r, qty) {
    qty = Math.max(1, Math.floor(qty || 1));
    const outN = r.out ? r.out.n : 1;
    const st = STATION_BY_ID[r.station];
    if (r.station === 'brewing') {
      const brews = Math.ceil(qty / 3);
      return { qty, outN, crafts: brews, total: qty, leftover: 0, perSlot: 1, rounds: 1, brews,
        blaze: Math.ceil(brews / 20), ingredients: [{ ref: r.in, count: qty }, { ref: r.re, count: brews }] };
    }
    const crafts = Math.ceil(qty / outN);
    const total = crafts * outN;
    const ingredients = this.ingredientsOf(r).map((e) => ({ ref: e.ref, count: e.count * crafts }));
    let rounds = 1;
    if (r.grid) {
      const minStack = Math.min(...r.grid.cells.filter(Boolean).map((c) => this.stackOf(this.ingItems(c)[0])));
      rounds = Math.ceil(crafts / Math.max(1, minStack));
    }
    const res = { qty, outN, crafts, total, leftover: total - qty, perSlot: crafts, rounds, ingredients };
    if (st && (st.kind === 'furnace')) {
      res.seconds = (r.time * crafts) / 20;
      res.xp = (r.xp || 0) * crafts;
    } else if (st && st.kind === 'campfire') {
      res.seconds = (r.time / 20) * Math.ceil(crafts / 4);
      res.xp = (r.xp || 0) * crafts;
    }
    return res;
  }

  stackOf(id) {
    const it = this.items[id];
    return it ? (it.s || 64) : 64;
  }

  /** Brennstoff für ein Ofen-Rezept: wie viele Items brennt ein Brennstoff-Item? */
  fuelFor(r, fuelId, crafts) {
    const st = STATION_BY_ID[r.station];
    const f = this.items[fuelId] && this.items[fuelId].fuel;
    if (!f || !st || st.kind !== 'furnace') return null;
    const burn = st.fast ? f / (this.meta.fastBurnDiv || 2) : f;
    const perFuel = burn / r.time;
    return { perFuel, count: Math.ceil(crafts / perFuel) };
  }

  fuels() {
    return Object.entries(this.items).filter(([, it]) => it.fuel).map(([id, it]) => ({ id, fuel: it.fuel }))
      .sort((a, b) => b.fuel - a.fuel);
  }

  // ---------------------------------------------------------------- Materialliste
  /**
   * Bis zu den Grundstoffen auflösen (nur Werkbank-Rezepte). Ergebnis: Rohstoffe, Zwischenschritte, Reste.
   * Grundstoff = hat kein Werkbank-Rezept, ist Ofen-Ergebnis (z. B. Eisenbarren, Glas) oder entsteht nur aus
   * seiner eigenen Speicherform (Schleimball ← Schleimblock).
   */
  breakdown(id, qty) {
    const raw = new Map();
    const steps = [];
    const left = new Map();
    const smelted = this.#smeltedSet || (this.#smeltedSet = new Set(this.recipes
      .filter((r) => ['smelting', 'blasting', 'smoking', 'campfire'].includes(r.t)).map((r) => r.out.id)));
    const addRaw = (ref, n) => {
      const k = refKey(ref);
      const e = raw.get(k);
      if (e) e.count += n; else raw.set(k, { ref, count: n });
    };
    const need = (ref, n, stack) => {
      // Zutat mit mehreren Möglichkeiten: Reste bevorzugen, sonst erstes Item als Stellvertreter
      const opts = this.ingItems(ref);
      let id2 = opts.find((o) => (left.get(o) || 0) > 0) || opts[0];
      const have = left.get(id2) || 0;
      if (have > 0) {
        const use = Math.min(have, n);
        left.set(id2, have - use);
        n -= use;
      }
      if (n <= 0) return;
      const recipe = !smelted.has(id2) && !stack.includes(id2) ? this.#preferred(id2) : null;
      if (!recipe) { addRaw(opts.length > 1 ? ref : id2, n); return; }
      const outN = recipe.out.n;
      const crafts = Math.ceil(n / outN);
      const extra = crafts * outN - n;
      if (extra) left.set(id2, (left.get(id2) || 0) + extra);
      steps.push({ id: id2, crafts, outN, recipe });
      for (const e of this.ingredientsOf(recipe)) need(e.ref, e.count * crafts, [...stack, id2]);
    };
    need(id, qty, []);
    const leftovers = [...left.entries()].filter(([, n]) => n > 0).map(([lid, n]) => ({ id: lid, count: n }));
    return { raw: [...raw.values()], steps: steps.reverse(), leftovers };
  }

  #smeltedSet = null;

  #preferred(id) {
    const list = (this.byOutput.get(id) || []).filter((r) => (r.t === 'shaped' || r.t === 'shapeless'));
    const ok = list.filter((r) => {
      const ings = this.ingredientsOf(r);
      // Speicherform zurückverwandeln (Block → 9 Barren) ist kein sinnvoller Bauweg
      if (ings.length === 1 && ings[0].count === 1 && r.out.n >= 4 && /(_block|^block_of|bale|_bundle)/.test(this.ingItems(ings[0].ref)[0])) return false;
      // Rezepte, deren Zutat das Ergebnis selbst enthält (z. B. Wolle umfärben)
      return !ings.some((e) => this.ingItems(e.ref).includes(id));
    });
    return ok[0] || null;
  }

  // ---------------------------------------------------------------- Freies Craften
  /** Prüft ein Raster (Array gridW*gridW mit Item-IDs oder null) gegen alle Werkbank-Rezepte. */
  matchCrafting(grid, gridW) {
    const filled = [];
    let minX = gridW, minY = gridW, maxX = -1, maxY = -1;
    grid.forEach((id, i) => {
      if (!id) return;
      const x = i % gridW, y = Math.floor(i / gridW);
      filled.push(id);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    if (!filled.length) return [];
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const box = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) box.push(grid[y * gridW + x] || null);
    const has = (ref, id) => this.ingItems(ref).includes(id);
    const hits = [];
    for (const r of this.byStation.get(gridW === 2 ? 'inventory' : 'crafting')) {
      const g = r.grid;
      if (!g) continue;
      if (g.shaped) {
        if (g.w !== w || g.h !== h) continue;
        const ok = (mirror) => box.every((id, i) => {
          const x = i % w, y = Math.floor(i / w);
          const ref = g.cells[y * w + (mirror ? w - 1 - x : x)];
          return ref == null ? id == null : id != null && has(ref, id);
        });
        if (ok(false) || ok(true)) hits.push(r);
      } else if (this.#matchShapeless(r, filled)) {
        hits.push(r);
      }
    }
    return hits;
  }

  #matchShapeless(r, items) {
    const has = (ref, id) => this.ingItems(ref).includes(id);
    const count = (pred) => items.filter(pred).length;
    switch (r.t) {
      case 'shapeless': return bipartite(r.i, items, has);
      case 'transmute': {
        const [lo, hi] = r.mc || [1, 1];
        const inputs = items.filter((id) => has(r.in, id));
        const mats = items.filter((id) => has(r.m, id) && !has(r.in, id));
        return inputs.length === 1 && mats.length >= lo && mats.length <= hi && inputs.length + mats.length === items.length;
      }
      case 'dye': case 'star_fade': {
        const tg = items.filter((id) => has(r.tg, id));
        const dyes = items.filter((id) => has(r.dye, id));
        return tg.length === 1 && dyes.length >= 1 && tg.length + dyes.length === items.length;
      }
      case 'banner_copy': return items.length === 2 && items.every((id) => has(r.b, id));
      case 'book_copy': {
        const src = count((id) => has(r.src, id));
        const mat = count((id) => has(r.m, id));
        return src === 1 && mat >= 1 && mat <= 8 && src + mat === items.length;
      }
      case 'rocket': {
        const paper = count((id) => has(r.shell, id));
        const fuel = count((id) => has(r.fuel, id));
        const star = count((id) => has(r.star, id));
        return paper === 1 && fuel >= 1 && fuel <= 3 && paper + fuel + star === items.length;
      }
      case 'star': {
        const fuel = count((id) => has(r.fuel, id));
        const dye = count((id) => has(r.dye, id));
        const shape = count((id) => Object.values(r.shapes).some((s) => has(s, id)));
        const trail = count((id) => has(r.trail, id));
        const tw = count((id) => has(r.twinkle, id));
        return fuel === 1 && dye >= 1 && shape <= 1 && trail <= 1 && tw <= 1 && fuel + dye + shape + trail + tw === items.length;
      }
      case 'shield_deco': return items.length === 2 && count((id) => has(r.tg, id)) === 1 && count((id) => has(r.b, id)) === 1;
      default: return false;
    }
  }

  /** Steinsäge, Öfen, Lagerfeuer: alle Ergebnisse für ein Eingabe-Item */
  matchSingleInput(station, id) {
    return this.byStation.get(station).filter((r) => this.ingItems(r.in).includes(id));
  }

  matchSmithing(tpl, base, add) {
    return this.byStation.get('smithing').filter((r) =>
      (!tpl || this.ingItems(r.tpl).includes(tpl)) && (!base || this.ingItems(r.b).includes(base)) && (!add || this.ingItems(r.a).includes(add)));
  }

  matchBrewing(input, reagent) {
    return this.byStation.get('brewing').filter((r) => r.in === input && this.ingItems(r.re).includes(reagent));
  }

  // ---------------------------------------------------------------- Tränke
  potionInfo(id) {
    const it = this.items[id];
    if (!it || !it.potion) return null;
    const p = this.potions[it.potion];
    if (!p) return null;
    const scale = it.pscale || 1;
    const effects = p.fx.map(([eid, dur, amp]) => {
      const e = this.effects[eid] || { n: [eid, eid], color: 0 };
      return { id: eid, n: e.n, amp, ticks: e.instant ? 0 : Math.floor(dur * scale), instant: !!e.instant, cat: e.cat };
    });
    return {
      potion: it.potion,
      color: p.color ?? this.meta.defaultPotionColor,
      effects,
      long: it.potion.startsWith('long_'),
      strong: it.potion.startsWith('strong_'),
    };
  }
}

function push(map, key, val, dup) {
  let a = map.get(key);
  if (!a) map.set(key, (a = []));
  if (dup && a.some(dup)) return;
  a.push(val);
}

function isSymmetric(g) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < Math.floor(g.w / 2); x++) {
      const a = g.cells[y * g.w + x], b = g.cells[y * g.w + (g.w - 1 - x)];
      if (refKey(a ?? '') !== refKey(b ?? '')) return false;
    }
  }
  return true;
}

/** Bipartites Matching Zutaten ↔ Items (formlose Rezepte, max. 9 Felder) */
function bipartite(ings, items, has) {
  if (ings.length !== items.length) return false;
  const used = new Array(items.length).fill(false);
  const order = ings.map((ref, i) => ({ ref, i, n: items.filter((id) => has(ref, id)).length })).sort((a, b) => a.n - b.n);
  const go = (k) => {
    if (k === order.length) return true;
    for (let j = 0; j < items.length; j++) {
      if (!used[j] && has(order[k].ref, items[j])) {
        used[j] = true;
        if (go(k + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  };
  return go(0);
}
