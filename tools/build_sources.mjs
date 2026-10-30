// Craftionary – Fundorte aus der offiziellen client.jar: Block-Drops, Kreaturen, Truhen in Strukturen, Archäologie, Angeln,
// Geschenke, Handel und Erz-Verteilungen über die Höhe. Ohne Java.
// Aufruf: node tools/build_sources.mjs [--work ./_mc]   → data/sources-<version>.json
//
// Chancen gelten für den Normalfall: Spieler tötet bzw. baut ab, ohne Glück, Plünderung, Behutsamkeit oder Schere
// (diese beiden werden zusätzlich durchgerechnet). Unbekannte Bedingungen (Feuer, Reittier, Ort …) gelten als nicht erfüllt.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadGame, strip } from './mojang.mjs';

const { version, data, files, json, en, de } = await loadGame((f) =>
  /^data\/minecraft\/(loot_table|predicate|villager_trade|trade_set|tags\/(villager_trade|worldgen\/biome|item)|worldgen\/(structure|placed_feature|feature|biome|density_function\/overworld\/ore_vein|material_rule\/overworld))\/.+\.json$/.test(f));

const warn = new Set();
const lang = (key, fallback) => [en[key] || fallback, de[key] || en[key] || fallback];
const pretty = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const ls = (dir) => Object.keys(files).filter((f) => f.startsWith(`data/minecraft/${dir}/`) && f.endsWith('.json'));
const idOf = (path, dir) => path.slice(`data/minecraft/${dir}/`.length, -5);

// ============================================================================ Zahlen-Verteilungen (Index = Anzahl)
const pmfConst = (v) => { const a = new Array(Math.max(0, v) + 1).fill(0); a[Math.max(0, v)] = 1; return a; };
function pmfProvider(p) {
  if (typeof p === 'number') return pmfConst(Math.round(p));
  const t = strip(p && p.type);
  if (t === 'constant') return pmfConst(Math.round(p.value));
  const pmin = p && (p.min ?? p.min_inclusive), pmax = p && (p.max ?? p.max_inclusive);
  if (t === 'uniform' && typeof pmin === 'number' && typeof pmax === 'number') {
    const lo = Math.floor(pmin), hi = Math.floor(pmax);
    const a = new Array(Math.max(0, hi) + 1).fill(0);
    for (let k = lo; k <= hi; k++) a[Math.max(0, k)] += 1 / (hi - lo + 1);
    return a;
  }
  if (t === 'binomial' && typeof p.n === 'number' && typeof p.p === 'number') return binom(p.n, p.p);
  warn.add(`Zahlengeber ${JSON.stringify(p).slice(0, 80)}`);
  return pmfConst(1);
}
function binom(n, p) {
  const a = [];
  let c = 1;
  for (let k = 0; k <= n; k++) { a[k] = c * p ** k * (1 - p) ** (n - k); c = (c * (n - k)) / (k + 1); }
  return a;
}
function conv(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
  return out;
}
const mix = (a, b, w) => { const n = Math.max(a.length, b.length); return Array.from({ length: n }, (_, i) => w * (a[i] || 0) + (1 - w) * (b[i] || 0)); };
const meanOf = (a) => a.reduce((s, x, i) => s + x * i, 0);
const pAny = (a) => 1 - (a[0] || 0);
const minPos = (a) => a.findIndex((x, i) => i > 0 && x > 1e-12);
const maxPos = (a) => { for (let i = a.length - 1; i > 0; i--) if (a[i] > 1e-12) return i; return -1; };

// ============================================================================ Bedingungen → Wahrscheinlichkeit
const predCache = {};
function condProb(c, mode) {
  if (c === undefined || c === null) return 1;
  if (Array.isArray(c)) return c.reduce((p, x) => p * condProb(x, mode), 1);
  if (typeof c === 'string') {
    const id = strip(c);
    if (id === 'tool/can_silk_touch') return mode.silk ? 1 : 0;
    if (id === 'tool/can_shear') return mode.shears ? 1 : 0;
    const path = `data/minecraft/predicate/${id}.json`;
    if (files[path]) return condProb((predCache[id] ??= json(path)), mode);
    warn.add(`Prädikat ${id}`);
    return 0;
  }
  switch (strip(c.type || c.condition)) {
    case 'survives_explosion': case 'match_block': case 'block_state_property': case 'killed_by_player': return 1;
    case 'random_chance': return typeof c.chance === 'number' ? c.chance : meanOf(pmfProvider(c.chance)) || 0;
    case 'random_chance_with_enchanted_bonus': return typeof c.unenchanted_chance === 'number' ? c.unenchanted_chance : 0;
    case 'table_bonus': return c.chances[0];
    case 'any_of': return 1 - (c.terms || []).reduce((p, x) => p * (1 - condProb(x, mode)), 1);
    case 'all_of': return (c.terms || []).reduce((p, x) => p * condProb(x, mode), 1);
    case 'inverted': return 1 - condProb(c.term, mode);
    case 'entity_properties': return JSON.stringify(c.predicate || {}).includes('"in_open_water":true') ? 1 : 0;
    default: return 0; // Ort, Schadensart, Werkzeug, Feuer … gelten als nicht erfüllt
  }
}
const entryCond = (e, mode) => condProb(e.condition ?? e.conditions, mode);

// ============================================================================ Mengen-Funktionen
function applyMods(e, mode, flags) {
  let pmf = pmfConst(1);
  const mods = [].concat(e.modifier ?? e.functions ?? []);
  for (const m of mods) {
    const type = strip(m.type || m.function);
    const c = condProb(m.condition ?? m.conditions, mode);
    if (c === 0) continue;
    let next = pmf;
    if (type === 'set_count') next = m.add ? conv(pmf, pmfProvider(m.count)) : pmfProvider(m.count);
    else if (type === 'limit_count') {
      const lo = typeof m.limit?.min === 'number' ? m.limit.min : 0, hi = typeof m.limit?.max === 'number' ? m.limit.max : Infinity;
      next = new Array(Math.min(pmf.length - 1, hi) + 1).fill(0);
      pmf.forEach((x, k) => { next[Math.min(Math.max(k, lo), hi)] += x; });
    } else if (type === 'apply_bonus') {
      flags.fortune = 1;
      if (strip(m.formula) === 'binomial_with_bonus_count') next = conv(pmf, binom(m.parameters.extra, m.parameters.probability));
    } else if (type === 'enchanted_count_increase') flags.looting = 1;
    else continue;
    pmf = c === 1 ? next : mix(next, pmf, c);
  }
  return pmf;
}

// ============================================================================ Einträge, Pools, Tabellen
function expand(e, mode) {
  const c = entryCond(e, mode);
  if (c === 0) return [];
  const w = e.weight ?? 1;
  const type = strip(e.type);
  if (type === 'item') { const flags = {}; return [{ w, f: c, item: strip(e.name), pmf: applyMods(e, mode, flags), flags }]; }
  if (type === 'loot_table') return [{ w, f: c, table: e.value }];
  if (type === 'empty') return [{ w, f: c, empty: true }];
  if (type === 'tag') return (tagItems(e.name) || []).map((item) => ({ w, f: c, item, pmf: applyMods(e, mode, {}), flags: {} }));
  if (type === 'alternatives' || type === 'group' || type === 'sequence') {
    const out = [];
    let rest = c;
    for (const ch of e.children || []) {
      const sub = expand(ch, mode);
      if (!sub.length) { if (type === 'sequence') break; continue; }
      const pass = Math.min(1, sub.reduce((s, x) => s + x.f, 0));
      out.push(...sub.map((x) => ({ ...x, f: x.f * (type === 'alternatives' ? rest : c) })));
      if (type === 'alternatives') { rest *= 1 - pass; if (rest <= 1e-12) break; }
    }
    return out;
  }
  if (type !== 'dynamic') warn.add(`Eintrag ${type}`);
  return [];
}

const tableCache = new Map();
function tableStats(ref, mode, stack = []) {
  const id = typeof ref === 'string' ? strip(ref) : null;
  const key = id ? `${id}|${mode.silk ? 's' : ''}${mode.shears ? 'h' : ''}` : null;
  if (key && tableCache.has(key)) return tableCache.get(key);
  if (id && stack.includes(id)) return {};
  const t = id ? (files[`data/minecraft/loot_table/${id}.json`] ? json(`data/minecraft/loot_table/${id}.json`) : null) : ref;
  if (!t) { warn.add(`Tabelle ${id}`); return {}; }
  const out = {};
  for (const pool of t.pools || []) {
    const pc = condProb(pool.condition ?? pool.conditions, mode);
    if (pc === 0) continue;
    const groups = (pool.entries || []).map((e) => expand(e, mode));
    const single = groups.length === 1;
    const total = groups.reduce((s, g) => s + g.reduce((a, x) => a + x.w * x.f, 0), 0);
    const roll = {};
    const add = (item, p, mean, min, max, flags) => {
      const r = (roll[item] ??= { q: 0, mean: 0, min: Infinity, max: 0, flags: {} });
      r.q += p; r.mean += mean; r.min = Math.min(r.min, min); r.max = Math.max(r.max, max); Object.assign(r.flags, flags);
    };
    for (const g of groups) for (const leaf of g) {
      const P = single ? leaf.f : total > 0 ? (leaf.w * leaf.f) / total : 0;
      if (P <= 0) continue;
      if (leaf.item && pAny(leaf.pmf) > 0) add(leaf.item, P * pAny(leaf.pmf), P * meanOf(leaf.pmf), minPos(leaf.pmf), maxPos(leaf.pmf), leaf.flags);
      else if (leaf.table) for (const [item, s] of Object.entries(tableStats(leaf.table, mode, id ? [...stack, id] : stack))) add(item, P * s.p, P * s.mean, s.min, s.max, s.flags);
    }
    const rolls = pmfProvider(pool.rolls ?? 1);
    for (const [item, r] of Object.entries(roll)) {
      const q = Math.min(1, r.q);
      const pNone = rolls.reduce((s, pr, k) => s + pr * (1 - q) ** k, 0);
      const o = (out[item] ??= { p: 0, mean: 0, min: Infinity, max: 0, flags: {} });
      o.p = 1 - (1 - o.p) * (1 - pc * (1 - pNone));
      o.mean += pc * meanOf(rolls) * r.mean;
      o.min = Math.min(o.min, r.min); o.max = Math.max(o.max, r.max); Object.assign(o.flags, r.flags);
    }
  }
  if (key) tableCache.set(key, out);
  return out;
}

// ============================================================================ Tags
const itemTagCache = new Map();
function tagItems(name) {
  const id = strip(name.replace(/^#/, ''));
  if (itemTagCache.has(id)) return itemTagCache.get(id);
  const path = `data/minecraft/tags/item/${id}.json`;
  if (!files[path]) return null;
  const out = [];
  itemTagCache.set(id, out);
  for (const v of json(path).values) { const r = typeof v === 'string' ? v : v.id; if (r.startsWith('#')) out.push(...(tagItems(r) || [])); else out.push(strip(r)); }
  return out;
}
function biomeTag(name, seen = new Set()) {
  const id = strip(name.replace(/^#/, ''));
  if (seen.has(id)) return [];
  seen.add(id);
  const path = `data/minecraft/tags/worldgen/biome/${id}.json`;
  if (!files[path]) { warn.add(`Biom-Tag ${id}`); return []; }
  return [...new Set(json(path).values.flatMap((v) => { const r = typeof v === 'string' ? v : v.id; return r.startsWith('#') ? biomeTag(r, seen) : [strip(r)]; }))];
}
function tradeTag(name, seen = new Set()) {
  const id = strip(name.replace(/^#/, ''));
  if (seen.has(id)) return [];
  seen.add(id);
  const path = `data/minecraft/tags/villager_trade/${id}.json`;
  if (!files[path]) { warn.add(`Handels-Tag ${id}`); return []; }
  return json(path).values.flatMap((v) => { const r = typeof v === 'string' ? v : v.id; return r.startsWith('#') ? tradeTag(r, seen) : [strip(r)]; });
}

// ============================================================================ Namen der Quellen (Strukturen haben im Spiel keine Übersetzung)
const STRUCT_NAMES = {
  abandoned_camp: ['Abandoned Camp', 'Verlassenes Lager'], mineshaft: ['Mineshaft', 'Verlassene Mine'], ancient_city: ['Ancient City', 'Antike Stätte'],
  bastion_remnant: ['Bastion Remnant', 'Bastionsruine'], buried_treasure: ['Buried Treasure', 'Vergrabener Schatz'], desert_pyramid: ['Desert Pyramid', 'Wüstentempel'],
  end_city: ['End City', 'Endsiedlung'], igloo: ['Igloo', 'Iglu'], jungle_pyramid: ['Jungle Temple', 'Dschungeltempel'], fortress: ['Nether Fortress', 'Netherfestung'],
  pillager_outpost: ['Pillager Outpost', 'Plünderer-Außenposten'], ruined_portal: ['Ruined Portal', 'Portalruine'], shipwreck: ['Shipwreck', 'Schiffswrack'],
  dungeon: ['Dungeon', 'Verlies'], bonus_chest: ['Bonus Chest', 'Bonustruhe'], stronghold: ['Stronghold', 'Festung'], trial_chambers: ['Trial Chambers', 'Prüfungskammern'],
  ocean_ruin: ['Ocean Ruins', 'Ozeanruine'], village: ['Village', 'Dorf'], mansion: ['Woodland Mansion', 'Waldanwesen'], trail_ruins: ['Trail Ruins', 'Pfadruine'],
  desert_well: ['Desert Well', 'Wüstenbrunnen'], monument: ['Ocean Monument', 'Ozeanmonument'], swamp_hut: ['Swamp Hut', 'Sumpfhütte'], nether_fossil: ['Nether Fossil', 'Netherfossil'],
};
const PART_NAMES = {
  common_chest: ['chest', 'Truhe'], secret_chest: ['secret chest', 'geheime Truhe'], barrel: ['barrel', 'Fass'], ice_box: ['ice box', 'Eiskiste'],
  bridge: ['bridge', 'Brücke'], hoglin_stable: ['hoglin stable', 'Hoglinstall'], other: ['other chests', 'übrige Truhen'], treasure: ['treasure', 'Schatzkammer'],
  dispenser: ['dispenser', 'Werfer'], map: ['map room', 'Kartenraum'], supply: ['supplies', 'Vorräte'], corridor: ['corridor', 'Gang'], crossing: ['crossing', 'Kreuzung'],
  library: ['library', 'Bibliothek'], entrance: ['entrance', 'Eingang'], intersection: ['intersection', 'Kreuzung'], intersection_barrel: ['intersection barrel', 'Kreuzung (Fass)'],
  reward: ['vault', 'Tresor'], reward_ominous: ['ominous vault', 'Unheilvoller Tresor'], big: ['large', 'groß'], small: ['small', 'klein'],
  cold: ['cold', 'kalt'], warm: ['warm', 'warm'], common: ['common', 'häufig'], rare: ['rare', 'selten'],
  desert_house: ['desert house', 'Wüstenhaus'], plains_house: ['plains house', 'Ebenenhaus'], savanna_house: ['savanna house', 'Savannenhaus'],
  snowy_house: ['snowy house', 'Schneehaus'], taiga_house: ['taiga house', 'Taigahaus'], temple: ['temple', 'Tempel'], tannery: ['tannery', 'Gerberei'],
};
const VILLAGE_PROF = { armorer: 'armorer', butcher: 'butcher', cartographer: 'cartographer', fisher: 'fisherman', fletcher: 'fletcher', mason: 'mason', shepherd: 'shepherd', toolsmith: 'toolsmith', weaponsmith: 'weaponsmith' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const join2 = (a, b) => (b ? [`${a[0]} – ${cap(b[0])}`, `${a[1]} – ${b[1]}`] : a);

// Truhen-Tabelle → [Strukturname-Schlüssel, Teil-Name, Strukturen für die Biome]
function chestInfo(key) {
  const [dir, rest = ''] = key.includes('/') ? key.split('/') : [null, key];
  if (dir === 'village') {
    const part = rest.replace(/^village_/, '');
    const prof = VILLAGE_PROF[part];
    const sub = prof ? lang(`entity.minecraft.villager.${prof}`, pretty(prof)) : PART_NAMES[part] || [pretty(part), pretty(part)];
    const typed = part.match(/^(desert|plains|savanna|snowy|taiga)_house$/);
    return ['village', sub, typed ? [`village_${typed[1]}`] : ['village_desert', 'village_plains', 'village_savanna', 'village_snowy', 'village_taiga']];
  }
  if (dir === 'trial_chambers') {
    const vault = lang('block.minecraft.vault', 'Vault');
    const part = rest === 'reward' ? vault : rest === 'reward_ominous' ? [`Ominous ${vault[0]}`, `${vault[1]} (unheilvoll)`] : PART_NAMES[rest] || [pretty(rest), pretty(rest)];
    return ['trial_chambers', part, ['trial_chambers']];
  }
  const rules = [
    [/^abandoned_camp_(.+)$/, 'abandoned_camp', 'abandoned_camp_*'], [/^abandoned_mineshaft$/, 'mineshaft', 'mineshaft,mineshaft_mesa'],
    [/^ancient_city(?:_(ice_box))?$/, 'ancient_city', 'ancient_city'], [/^bastion_(.+)$/, 'bastion_remnant', 'bastion_remnant'],
    [/^buried_treasure$/, 'buried_treasure', 'buried_treasure'], [/^desert_pyramid$/, 'desert_pyramid', 'desert_pyramid'],
    [/^end_city_(treasure)$/, 'end_city', 'end_city'], [/^igloo_chest$/, 'igloo', 'igloo'], [/^jungle_temple(?:_(dispenser))?$/, 'jungle_pyramid', 'jungle_pyramid'],
    [/^nether_bridge$/, 'fortress', 'fortress'], [/^pillager_outpost$/, 'pillager_outpost', 'pillager_outpost'], [/^ruined_portal$/, 'ruined_portal', 'ruined_portal*'],
    [/^shipwreck_(.+)$/, 'shipwreck', 'shipwreck,shipwreck_beached'], [/^simple_dungeon$/, 'dungeon', ''], [/^spawn_bonus_chest$/, 'bonus_chest', ''],
    [/^stronghold_(.+)$/, 'stronghold', 'stronghold'], [/^underwater_ruin_(.+)$/, 'ocean_ruin', 'ocean_ruin_cold,ocean_ruin_warm'],
    [/^woodland_mansion$/, 'mansion', 'mansion'], [/^abandoned_camp_barrel$/, 'abandoned_camp', 'abandoned_camp_*'],
  ];
  for (const [re, struct, list] of rules) {
    const m = rest.match(re);
    if (m) return [struct, m[1] ? PART_NAMES[m[1]] || [pretty(m[1]), pretty(m[1])] : null, expandStructs(list)];
  }
  warn.add(`Truhe ohne Struktur: ${key}`);
  return [null, [pretty(rest), pretty(rest)], []];
}
const ALL_STRUCTS = ls('worldgen/structure').map((p) => idOf(p, 'worldgen/structure'));
const expandStructs = (list) => (list ? list.split(',').flatMap((s) => (s.endsWith('*') ? ALL_STRUCTS.filter((x) => x.startsWith(s.slice(0, -1))) : [s])) : []);

const OTHER_NAMES = {
  'gameplay/fishing': [['Fishing', 'Angeln'], 'fish'], 'gameplay/cat_morning_gift': [['Cat morning gift', 'Geschenk einer Katze'], 'gift'],
  'gameplay/piglin_bartering': [['Piglin bartering', 'Tauschhandel mit Piglins'], 'gift'], 'gameplay/sniffer_digging': [['Sniffer digging', 'Schnüffler gräbt'], 'gift'],
  'gameplay/panda_sneeze': [['Panda sneeze', 'Niesender Panda'], 'gift'], 'gameplay/chicken_lay': [['Chicken lays', 'Huhn legt'], 'gift'],
  'gameplay/armadillo_shed': [['Armadillo sheds', 'Gürteltier häutet sich'], 'gift'], 'gameplay/turtle_grow': [['Turtle grows up', 'Schildkröte wächst'], 'gift'],
  'brush/armadillo': [['Brushing an armadillo', 'Gürteltier abbürsten'], 'gift'], 'carve/pumpkin': [['Carving a pumpkin', 'Kürbis schnitzen'], 'gift'],
  'till/rooted_dirt': [['Tilling rooted dirt', 'Wurzelerde hacken'], 'gift'], 'harvest/beehive': [['Harvesting a beehive', 'Bienenstock ernten'], 'gift'],
  'harvest/cave_vine': [['Harvesting cave vines', 'Höhlenranken ernten'], 'gift'], 'harvest/sweet_berry_bush': [['Harvesting sweet berries', 'Süßbeeren ernten'], 'gift'],
};

// ============================================================================ Quellen sammeln
const items = data.items;
const names = {};
const nameOf = (key, n) => { names[key] ??= n; return key; };
const blockName = (id) => (items[id] ? [items[id].n[0], items[id].n[1]] : lang(`block.minecraft.${id}`, pretty(id)));
const bySource = {};
const push = (item, row) => { if (items[item]) (bySource[item] ??= []).push(row); };
const r4 = (x) => Math.round(x * 10000) / 10000;
const r2 = (x) => Math.round(x * 100) / 100;
const flagStr = (f, extra = '') => (f.fortune ? 'F' : '') + (f.looting ? 'L' : '') + extra;
const row = (kind, key, s, extra = '') => [kind, key, r4(s.p), r2(s.mean), s.min, s.max, flagStr(s.flags, extra)];

// Unter-Tabellen (von anderen Tabellen eingebunden) nicht doppelt als eigene Quelle zeigen
const referenced = new Set();
for (const p of ls('loot_table')) JSON.stringify(json(p)).replace(/"type":"minecraft:loot_table"[^}]*?"value":"minecraft:([^"]+)"/g, (_, v) => { referenced.add(v); return ''; });

const chestStructs = {};
const NORMAL = { silk: false, shears: false }, SILK = { silk: true, shears: false }, SHEARS = { silk: false, shears: true };
for (const path of ls('loot_table')) {
  const id = idOf(path, 'loot_table');
  if (referenced.has(id) && !id.startsWith('blocks/')) continue;
  const [dir, ...restParts] = id.split('/');
  const rest = restParts.join('/');
  if (dir === 'blocks') {
    const block = rest;
    const normal = tableStats(id, NORMAL);
    nameOf(`block:${block}`, blockName(block));
    for (const [item, s] of Object.entries(normal)) {
      if (item === block && s.p > 0.999 && s.min === 1 && s.max === 1) continue; // Block lässt sich selbst fallen – trivial
      push(item, row('block', block, s));
    }
    for (const [mode, tag] of [[SILK, 'S'], [SHEARS, 'H']]) {
      for (const [item, s] of Object.entries(tableStats(id, mode))) if (!normal[item]) push(item, row('block', block, s, tag));
    }
  } else if (dir === 'entities' && !rest.includes('/')) {
    nameOf(`mob:${rest}`, lang(`entity.minecraft.${rest}`, pretty(rest)));
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row('mob', rest, s));
  } else if (dir === 'shearing' && !rest.includes('/')) {
    nameOf(`mob:${rest}`, lang(`entity.minecraft.${rest}`, pretty(rest)));
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row('shear', rest, s));
  } else if (dir === 'charged_creeper') {
    nameOf(`mob:${rest}`, lang(`entity.minecraft.${rest}`, pretty(rest)));
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row('creeper', rest, s));
  } else if (dir === 'chests' || dir === 'barrels' || dir === 'pots' || dir === 'spawners') {
    const key = dir === 'chests' ? rest : `${dir}/${rest}`;
    const [struct, part, structs] = dir === 'chests' ? chestInfo(rest)
      : dir === 'barrels' ? ['abandoned_camp', PART_NAMES.barrel, expandStructs('abandoned_camp_*')]
        : ['trial_chambers', dir === 'pots' ? lang('block.minecraft.decorated_pot', 'Decorated Pot')
          : lang('block.minecraft.trial_spawner', 'Trial Spawner').map((n, i) => (rest.includes('ominous') ? (i ? `${n} (unheilvoll)` : `${n} (ominous)`) : n)), ['trial_chambers']];
    nameOf(`chest:${key}`, join2(STRUCT_NAMES[struct] || [pretty(key), pretty(key)], part));
    chestStructs[key] = structs;
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row('chest', key, s));
  } else if (dir === 'archaeology') {
    const struct = rest.replace(/_(common|rare)$/, '').replace(/^ocean_ruin_(cold|warm)$/, 'ocean_ruin_$1');
    const base = struct.startsWith('ocean_ruin') ? 'ocean_ruin' : struct;
    const part = rest.match(/_(common|rare|cold|warm)$/)?.[1];
    nameOf(`chest:arch/${rest}`, join2(STRUCT_NAMES[base] || [pretty(base), pretty(base)], part ? PART_NAMES[part] : null));
    chestStructs[`arch/${rest}`] = struct === 'desert_well' ? [] : expandStructs(struct);
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row('brush', `arch/${rest}`, s));
  } else if (OTHER_NAMES[id]) {
    const [n, kind] = OTHER_NAMES[id];
    nameOf(`other:${id}`, n);
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row(kind, id, s));
  } else if (dir === 'gameplay' && rest.startsWith('hero_of_the_village/')) {
    const prof = rest.split('/')[1].replace(/_gift$/, '');
    const pn = prof === 'baby' ? ['Baby villager', 'Dorfbewohner-Kind'] : prof === 'unemployed' ? lang('entity.minecraft.villager.none', 'Villager') : lang(`entity.minecraft.villager.${prof}`, pretty(prof));
    nameOf(`other:${id}`, [`Hero of the Village: ${pn[0]}`, `Held des Dorfes: ${pn[1]}`]);
    for (const [item, s] of Object.entries(tableStats(id, NORMAL))) push(item, row('gift', id, s));
  }
}

// ============================================================================ Strukturen → Biome
const NETHER = new Set(['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas']);
const dimOf = (b) => (NETHER.has(b) ? 'nether' : /^(the_end|end_|small_end_islands|the_void)/.test(b) ? 'end' : 'overworld');
const structs = {};
for (const s of new Set(Object.values(chestStructs).flat())) {
  const path = `data/minecraft/worldgen/structure/${s}.json`;
  if (!files[path]) { warn.add(`Struktur ${s}`); continue; }
  const b = json(path).biomes;
  structs[s] = typeof b === 'string' ? (b.startsWith('#') ? biomeTag(b) : [strip(b)]) : b.map(strip);
}
const biomeFiles = ls('worldgen/biome').map((p) => [idOf(p, 'worldgen/biome'), json(p)]);
const overworld = biomeFiles.map(([b]) => b).filter((b) => dimOf(b) === 'overworld');
for (const b of new Set([...Object.values(structs).flat(), ...biomeFiles.map(([x]) => x)])) nameOf(`biome:${b}`, lang(`biome.minecraft.${b}`, pretty(b)));

// ============================================================================ Erze über die Höhe
const DIM = { overworld: [-64, 319], nether: [0, 255], end: [0, 255] };
const anchor = (a, dim) => ('absolute' in a ? a.absolute : 'above_bottom' in a ? DIM[dim][0] + a.above_bottom : DIM[dim][1] - a.below_top);
const ores = {};
const oreBlocks = {};
for (const path of ls('worldgen/placed_feature')) {
  const key = idOf(path, 'worldgen/placed_feature');
  const pf = json(path);
  const fid = typeof pf.feature === 'string' ? strip(pf.feature) : null;
  const f = fid ? (files[`data/minecraft/worldgen/feature/${fid}.json`] ? json(`data/minecraft/worldgen/feature/${fid}.json`) : null) : pf.feature;
  if (!f || !/^(ore|scattered_ore)$/.test(strip(f.type))) continue;
  const targets = [...new Set((f.targets || []).map((t) => strip(t.state?.Name || t.state)))].filter((b) => /_ore$|^ancient_debris$/.test(b));
  if (!targets.length) continue;
  const biomes = biomeFiles.filter(([, b]) => JSON.stringify(b.features || []).includes(`"minecraft:${key}"`)).map(([id]) => id);
  if (!biomes.length) continue;
  const dim = dimOf(biomes[0]);
  let n = 1, shape = null, lo, hi, pl = 0;
  for (const p of pf.placement || []) {
    const t = strip(p.type);
    if (t === 'count') n *= typeof p.count === 'number' ? p.count : meanOf(pmfProvider(p.count));
    else if (t === 'rarity_filter') n /= p.chance;
    else if (t === 'height_range') {
      const h = p.height;
      shape = strip(h.type);
      lo = anchor(h.min_inclusive, dim); hi = anchor(h.max_inclusive, dim); pl = h.plateau || 0;
    }
  }
  if (!['uniform', 'trapezoid'].includes(shape)) { warn.add(`Höhenform ${shape} in ${key}`); continue; }
  const all = dim === 'overworld' && overworld.every((b) => biomes.includes(b));
  ores[key] = { dim, shape: shape === 'uniform' ? 'u' : 't', lo, hi, pl, n: r4(n), size: f.size, air: f.discard_chance_on_air_exposure ?? 0, b: all ? 'all' : biomes };
  for (const b of targets) (oreBlocks[b] ??= []).push(key);
}
// Große Erzadern (Tuff + Eisen, Granit + Kupfer) stehen als Dichte-Funktion in den Daten
const veins = {};
for (const kind of ['iron', 'copper']) {
  const d = json(`data/minecraft/worldgen/density_function/overworld/ore_vein/${kind}_density.json`);
  const r = json(`data/minecraft/worldgen/material_rule/overworld/${kind}_ore_vein.json`);
  veins[kind] = { lo: d.min_inclusive, hi: d.max_exclusive - 1, ore: strip(r.ore_block), raw: strip(r.raw_ore_block), rawChance: r.raw_ore_chance, filler: strip(r.filler_block) };
}

// ============================================================================ Handel
const trades = {};
for (const path of ls('trade_set')) {
  const set = idOf(path, 'trade_set');
  const [prof, lvlName] = set.split('/');
  const lvl = +(lvlName || '').replace(/\D/g, '') || 0;
  const ts = json(path);
  const ids = typeof ts.trades === 'string' ? (ts.trades.startsWith('#') ? tradeTag(ts.trades) : [strip(ts.trades)]) : ts.trades.map(strip);
  nameOf(`prof:${prof}`, prof === 'wandering_trader' ? lang('entity.minecraft.wandering_trader', 'Wandering Trader') : lang(`entity.minecraft.villager.${prof}`, pretty(prof)));
  for (const tid of ids) {
    const tp = `data/minecraft/villager_trade/${tid}.json`;
    if (!files[tp]) { warn.add(`Handel ${tid}`); continue; }
    const t = json(tp);
    const item = strip(t.gives?.id);
    const wants = [t.wants, t.additional_wants].filter(Boolean).map((w) => [strip(w.id), typeof w.count === 'number' ? w.count : w.count ? meanOf(pmfProvider(w.count)) : 1]);
    const variant = JSON.stringify(t.merchant_predicate || {}).match(/villager\/variant":"minecraft:([a-z_]+)/)?.[1] || null;
    if (variant) nameOf(`biome:${variant}`, lang(`biome.minecraft.${variant}`, pretty(variant)));
    if (items[item]) (trades[item] ??= []).push([prof, lvl, wants, typeof t.gives.count === 'number' ? t.gives.count : 1, t.max_uses ?? null, variant]);
  }
}
for (let i = 1; i <= 5; i++) nameOf(`lvl:${i}`, lang(`merchant.level.${i}`, String(i)));

// ============================================================================ Ausgabe
for (const k of Object.keys(names)) if (!names[k][0]) delete names[k];
const out = { version, names, structs, chestStructs, ores, oreBlocks, veins, items: bySource, trades };
const target = join(ROOT, `data/sources-${version}.json`);
writeFileSync(target, JSON.stringify(out) + '\n');
const kb = Math.round(JSON.stringify(out).length / 1024);
console.log(`Fundorte: ${Object.keys(bySource).length} Items mit Quellen, ${Object.keys(trades).length} mit Handel, ${Object.keys(ores).length} Erz-Verteilungen, ${kb} KB → ${target}`);
if (warn.size) console.log('Hinweise:\n  ' + [...warn].sort().join('\n  '));
