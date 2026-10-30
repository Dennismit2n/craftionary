// Craftionary – Muster aus der offiziellen client.jar lesen: Bannermuster (Webstuhl, mit Namen je Farbe DE/EN),
// welche Muster eine Bannervorlage brauchen, und die Töpferscherben für den Verzierten Krug.
// Aufruf: node tools/build_patterns.mjs [--work ./_mc]   → data/patterns-<version>.json

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadGame, strip } from './mojang.mjs';

const { version, data, files, json, en, de } = await loadGame((f) => /^data\/minecraft\/(banner_pattern\/[^/]+|tags\/banner_pattern\/.+|tags\/item\/decorated_pot_sherds)\.json$/.test(f));

// Farbreihenfolge wie DyeColor im Spiel (so liegen sie auch in data/<version>.json)
const colors = Object.keys(data.dyeColors);
if (colors.length !== 16) throw new Error(`Erwarte 16 Farben, gefunden: ${colors.length}`);

const free = json('data/minecraft/tags/banner_pattern/no_item_required.json').values.map(strip);

// Vorlagen: Tag pattern_item/<x> gehört zum Item <x>_banner_pattern (der Bezug steht im Spielcode, nicht in den Daten)
const byItem = {};
for (const path of Object.keys(files).filter((f) => f.startsWith('data/minecraft/tags/banner_pattern/pattern_item/'))) {
  const tag = path.split('/').pop().slice(0, -5);
  const item = `${tag}_banner_pattern`;
  if (!data.items[item]) throw new Error(`Bannervorlage fehlt in den App-Daten: ${item}`);
  for (const p of json(path).values.map(strip)) byItem[p] = item;
}
// Reihenfolge der Vorlagen wie im Kreativ-Inventar
const ITEM_ORDER = ['flower', 'creeper', 'skull', 'mojang', 'globe', 'piglin', 'flow', 'guster', 'field_masoned', 'bordure_indented'];
const rank = (p) => { const i = ITEM_ORDER.indexOf(byItem[p].replace(/_banner_pattern$/, '')); return i < 0 ? 99 : i; };

const banner = [];
const seen = new Set();
const add = (id, item) => {
  const path = `data/minecraft/banner_pattern/${id}.json`;
  if (!files[path]) throw new Error(`Bannermuster fehlt: ${id}`);
  const j = json(path);
  const key = j.translation_key;
  const n = [colors.map((c) => en[`${key}.${c}`]), colors.map((c) => de[`${key}.${c}`] || en[`${key}.${c}`])];
  if (n[0].some((x) => !x)) throw new Error(`Namen fehlen: ${key}`);
  banner.push({ id, tex: strip(j.asset_id), ...(item ? { item } : {}), n });
  seen.add(id);
};
for (const id of free) add(id, null);
for (const id of Object.keys(byItem).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) add(id, byItem[id]);
const all = Object.keys(files).filter((f) => /^data\/minecraft\/banner_pattern\/[^/]+\.json$/.test(f)).map((f) => f.split('/').pop().slice(0, -5));
const missing = all.filter((id) => id !== 'base' && !seen.has(id));
if (missing.length) throw new Error(`Muster ohne Webstuhl-Weg: ${missing.join(', ')}`);

const sherds = json('data/minecraft/tags/item/decorated_pot_sherds.json').values.map(strip);
for (const s of sherds) if (!data.items[s]) throw new Error(`Scherbe fehlt in den App-Daten: ${s}`);

const target = join(ROOT, `data/patterns-${version}.json`);
writeFileSync(target, JSON.stringify({ version, colors, banner, sherds }) + '\n');
console.log(`Bannermuster: ${banner.length} (${Object.keys(byItem).length} mit Vorlage), Scherben: ${sherds.length} → ${target}`);
