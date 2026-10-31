// Craftionary – Namenspakete für die übrigen 12 Sprachen aus Mojangs offiziellen Sprachdateien (plus tools/names_extra.json
// für Namen, die das Spiel nicht übersetzt). Jeder Name wird über denselben Weg gesucht wie Englisch und Deutsch in den
// App-Daten; stimmt dieser Weg für en/de nicht exakt, bricht das Werkzeug ab.
// Aufruf: node tools/build_names.mjs [--work ./_mc]   → data/lang-<version>/<code>.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadGame, langFile } from './mojang.mjs';

export const PACK_LANGS = { es: 'es_es', fr: 'fr_fr', it: 'it_it', nl: 'nl_nl', pl: 'pl_pl', pt: 'pt_br', tr: 'tr_tr', ru: 'ru_ru', hi: 'hi_in', zh: 'zh_cn', ja: 'ja_jp', ko: 'ko_kr' };

const { version, data, en, de, index } = await loadGame(() => false);
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const ench = read(`data/enchantments-${version}.json`);
const pat = read(`data/patterns-${version}.json`);
const src = read(`data/sources-${version}.json`);
const EXTRA = read('tools/names_extra.json');
const LI = Object.fromEntries(EXTRA._langs.map((l, i) => [l, i]));
const LANG = { en, de };
for (const [code, file] of Object.entries(PACK_LANGS)) LANG[code] = await langFile(index, version, file);

// ------------------------------------------------------------------ Rezepte für einen Namen
// {k} offizieller Schlüssel · {x:[tabelle,id]} Handtabelle · {cat:[a,b]} „Struktur · Teil“ · {hero:r} Held des Dorfes
const K = (k) => ({ k });
const X = (t, id) => ({ x: [t, id] });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function render(r, l) {
  if (!r) return null;
  if (r.k) return LANG[l][r.k] ?? (l === 'de' ? en[r.k] : null) ?? null;
  if (r.x) {
    const row = EXTRA[r.x[0]][r.x[1]];
    if (!row) throw new Error(`names_extra.json: ${r.x.join('.')} fehlt`);
    return row[LI[l]];
  }
  if (r.cat) {
    const a = render(r.cat[0], l), b = render(r.cat[1], l);
    if (a == null || b == null) return null;
    return `${a} · ${l === 'en' ? cap(b) : b}`;
  }
  if (r.hero) {
    const h = render(K('effect.minecraft.hero_of_the_village'), l), p = render(r.hero, l);
    return h == null || p == null ? null : h + EXTRA.join.colon[LI[l]] + p;
  }
  if (r.list) {
    const names = r.list.map((x) => render(x, l));
    if (names.some((n) => n == null)) return null;
    const or = EXTRA.join.or[LI[l]], sep = EXTRA.join.sep[LI[l]];
    return names.length === 1 ? names[0] : names.slice(0, -1).join(sep) + or + names.at(-1);
  }
  throw new Error('unbekanntes Rezept ' + JSON.stringify(r));
}

// ------------------------------------------------------------------ Items, Untertitel, Tags, UI, Wirkungen, Verzauberungen
const recipes = { items: {}, subs: {}, tags: {}, ui: {}, effects: {}, ench: {}, src: {} };
const expect = { items: {}, subs: {}, tags: {}, ui: {}, effects: {}, ench: {}, src: {} };

for (const [id, it] of Object.entries(data.items)) {
  recipes.items[id] = K(it.k);
  expect.items[id] = it.n;
  if (it.sub) {
    const cands = [`${it.k}.desc`];
    const trim = id.match(/^(.+)_armor_trim_smithing_template$/);
    if (trim) cands.push(`trim_pattern.minecraft.${trim[1]}`);
    const up = id.match(/^(.+_upgrade)_smithing_template$/);
    if (up) cands.push(`upgrade.minecraft.${up[1]}`);
    let key = cands.find((c) => en[c] === it.sub[0] && (de[c] ?? en[c]) === it.sub[1]);
    if (!key) {
      const hits = Object.keys(en).filter((c) => c.startsWith('jukebox_song.') && en[c] === it.sub[0] && (de[c] ?? en[c]) === it.sub[1]);
      if (hits.length === 1) key = hits[0];
    }
    if (!key) throw new Error(`Untertitel ohne Schlüssel: ${id} (${it.sub[0]})`);
    recipes.subs[id] = K(key);
    expect.subs[id] = it.sub;
  }
}

const HAND_TAGS = new Set(Object.keys(EXTRA.tags));
for (const [t, members] of Object.entries(data.tags)) {
  if (HAND_TAGS.has(t)) {
    recipes.tags[t] = X('tags', t);
    expect.tags[t] = data.tagNames[t];
  } else if (members.length === 1) {
    recipes.tags[t] = K(data.items[members[0]].k);
    expect.tags[t] = data.tagNames[t];
  } else {
    // „A oder B“ aus offiziellen Namen; entrindete Varianten gehören stillschweigend dazu
    const pick = members.length > 3 ? members.filter((m) => !m.startsWith('stripped_')) : members;
    if (pick.length > 3) throw new Error(`Tag ${t} braucht eine Bezeichnung in tools/names_extra.json`);
    recipes.tags[t] = { list: pick.map((m) => K(data.items[m].k)) };
  }
}

for (const key of Object.keys(data.ui)) { recipes.ui[key] = K(key); expect.ui[key] = data.ui[key]; }
for (const [eid, e] of Object.entries(data.effects)) { recipes.effects[eid] = K(`effect.minecraft.${eid}`); expect.effects[eid] = e.n; }
for (const [id, e] of Object.entries(ench.enchantments)) { recipes.ench[id] = K(`enchantment.minecraft.${id}`); expect.ench[id] = e.n; }

// ------------------------------------------------------------------ Bannermuster (16 Farben je Muster)
const patKeys = {};
for (const b of pat.banner) {
  const hits = Object.keys(en).filter((k) => k.startsWith('block.minecraft.banner.') && k.endsWith(`.${pat.colors[0]}`) && en[k] === b.n[0][0]);
  const base = hits.map((k) => k.slice(0, -(pat.colors[0].length + 1)))
    .find((p) => pat.colors.every((c, i) => en[`${p}.${c}`] === b.n[0][i] && (de[`${p}.${c}`] ?? en[`${p}.${c}`]) === b.n[1][i]));
  if (!base) throw new Error(`Bannermuster ohne Schlüssel: ${b.id}`);
  patKeys[b.id] = base;
}

// ------------------------------------------------------------------ Fundorte (gleiche Logik wie tools/build_sources.mjs)
const VILLAGE_PROF = { armorer: 'armorer', butcher: 'butcher', cartographer: 'cartographer', fisher: 'fisherman', fletcher: 'fletcher', mason: 'mason', shepherd: 'shepherd', toolsmith: 'toolsmith', weaponsmith: 'weaponsmith' };
const CHEST_RULES = [
  [/^abandoned_camp_(.+)$/, 'abandoned_camp'], [/^abandoned_mineshaft$/, 'mineshaft'], [/^ancient_city(?:_(ice_box))?$/, 'ancient_city'],
  [/^bastion_(.+)$/, 'bastion_remnant'], [/^buried_treasure$/, 'buried_treasure'], [/^desert_pyramid$/, 'desert_pyramid'], [/^end_city_(treasure)$/, 'end_city'],
  [/^igloo_chest$/, 'igloo'], [/^jungle_temple(?:_(dispenser))?$/, 'jungle_pyramid'], [/^nether_bridge$/, 'fortress'], [/^pillager_outpost$/, 'pillager_outpost'],
  [/^ruined_portal$/, 'ruined_portal'], [/^shipwreck_(.+)$/, 'shipwreck'], [/^simple_dungeon$/, 'dungeon'], [/^spawn_bonus_chest$/, 'bonus_chest'],
  [/^stronghold_(.+)$/, 'stronghold'], [/^underwater_ruin_(.+)$/, 'ocean_ruin'], [/^woodland_mansion$/, 'mansion'], [/^abandoned_camp_barrel$/, 'abandoned_camp'],
];
const withPart = (struct, part) => (part ? { cat: [X('structs', struct), part] } : X('structs', struct));

function chestRecipe(key) {
  if (key.startsWith('arch/')) {
    const rest = key.slice(5);
    const struct = rest.replace(/_(common|rare)$/, '');
    const base = struct.startsWith('ocean_ruin') ? 'ocean_ruin' : struct;
    const part = rest.match(/_(common|rare|cold|warm)$/)?.[1];
    return withPart(base, part ? X('parts', part) : null);
  }
  if (key.startsWith('barrels/')) return withPart('abandoned_camp', X('parts', 'barrel'));
  if (key.startsWith('pots/')) return withPart('trial_chambers', K('block.minecraft.decorated_pot'));
  if (key.startsWith('spawners/')) return withPart('trial_chambers', key.includes('ominous') ? X('special', 'ominousSpawner') : K('block.minecraft.trial_spawner'));
  const [dir, rest = ''] = key.includes('/') ? key.split('/') : [null, key];
  if (dir === 'village') {
    const part = rest.replace(/^village_/, '');
    return withPart('village', VILLAGE_PROF[part] ? K(`entity.minecraft.villager.${VILLAGE_PROF[part]}`) : X('parts', part));
  }
  if (dir === 'trial_chambers') {
    return withPart('trial_chambers', rest === 'reward' ? K('block.minecraft.vault') : rest === 'reward_ominous' ? X('special', 'ominousVault') : X('parts', rest));
  }
  for (const [re, struct] of CHEST_RULES) {
    const m = rest.match(re);
    if (m) return withPart(struct, m[1] ? X('parts', m[1]) : null);
  }
  return null;
}

for (const [key, pair] of Object.entries(src.names)) {
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  let r = null;
  if (kind === 'block') r = data.items[rest] ? K(data.items[rest].k) : K(`block.minecraft.${rest}`);
  else if (kind === 'mob') r = K(`entity.minecraft.${rest}`);
  else if (kind === 'biome') r = K(`biome.minecraft.${rest}`);
  else if (kind === 'prof') r = K(rest === 'wandering_trader' ? 'entity.minecraft.wandering_trader' : `entity.minecraft.villager.${rest}`);
  else if (kind === 'lvl') r = K(`merchant.level.${rest}`);
  else if (kind === 'chest') r = chestRecipe(rest);
  else if (kind === 'other') {
    const prof = rest.match(/^gameplay\/hero_of_the_village\/(.+)_gift$/)?.[1];
    if (prof) r = { hero: prof === 'baby' ? X('special', 'babyVillager') : K(prof === 'unemployed' ? 'entity.minecraft.villager.none' : `entity.minecraft.villager.${prof}`) };
    else if (EXTRA.other[rest]) r = X('other', rest);
  }
  if (!r) throw new Error(`Fundort ohne Namensweg: ${key}`);
  recipes.src[key] = r;
  expect.src[key] = pair;
}

// ------------------------------------------------------------------ Gegenprobe: en/de müssen exakt die App-Daten treffen
const bad = [];
for (const [sec, list] of Object.entries(expect)) {
  for (const [id, pair] of Object.entries(list)) {
    for (const l of ['en', 'de']) {
      const got = render(recipes[sec][id], l);
      // Schlüssel ohne Text gibt es im Spiel als Rückfall auf den Namen in Klammern („Pretty Name“); dann zählt der Rückfall
      if (got !== pair[LI[l]] && !(got == null && sec === 'src')) bad.push(`${sec}.${id} [${l}]: erwartet „${pair[LI[l]]}“, gefunden „${got}“`);
    }
  }
}
for (const [id, base] of Object.entries(patKeys)) if (!base) bad.push(`pat.${id}`);
if (bad.length) {
  console.error(`Gegenprobe gescheitert (${bad.length}):\n  ` + bad.slice(0, 40).join('\n  '));
  process.exit(1);
}

// ------------------------------------------------------------------ Pakete schreiben
const outDir = join(ROOT, `data/lang-${version}`);
mkdirSync(outDir, { recursive: true });
const report = [];
for (const code of Object.keys(PACK_LANGS)) {
  const pack = { lang: code, version };
  let missing = 0, total = 0;
  for (const sec of Object.keys(recipes)) {
    pack[sec] = {};
    for (const [id, r] of Object.entries(recipes[sec])) {
      // Blöcke, die auch Items sind, heißen genauso wie das Item: die App nimmt dann den Namen aus „items“
      if (sec === 'src' && id.startsWith('block:') && data.items[id.slice(6)]) continue;
      total++;
      const v = render(r, code);
      if (v == null || v === '') { missing++; continue; }
      pack[sec][id] = v;
    }
  }
  pack.pat = {};
  for (const [id, base] of Object.entries(patKeys)) {
    const names = pat.colors.map((c) => LANG[code][`${base}.${c}`]);
    if (names.every(Boolean)) pack.pat[id] = names; else missing++;
    total++;
  }
  const json = JSON.stringify(pack);
  writeFileSync(join(outDir, `${code}.json`), json + '\n');
  report.push(`${code}: ${Math.round(json.length / 1024)} KB, ${total - missing}/${total} Namen${missing ? ` (${missing} fehlen, dort gilt Englisch)` : ''}`);
}
console.log(`Namenspakete ${version} → ${outDir}\n  ` + report.join('\n  '));
