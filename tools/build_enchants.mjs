// Craftionary – Verzauberungen aus der offiziellen client.jar lesen (Maximalstufe, passende Items, Ausschluss-Gruppen, Namen DE/EN)
// Aufruf: node tools/build_enchants.mjs [--work ./_mc]   → data/enchantments-<version>.json
// Braucht kein Java: Verzauberungen und Item-Tags liegen als JSON in der Jar, de_de.json kommt aus Mojangs Asset-Index.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadGame, strip } from './mojang.mjs';

const { version, data, files, json, en, de } = await loadGame((f) => /^data\/minecraft\/(enchantment\/[^/]+|tags\/(item|enchantment)\/.+)\.json$/.test(f));
const items = new Set(Object.keys(data.items));

const tagCache = new Map();
function itemTag(name) {
  if (tagCache.has(name)) return tagCache.get(name);
  const out = new Set();
  tagCache.set(name, out);
  const path = `data/minecraft/tags/item/${strip(name)}.json`;
  if (!files[path]) throw new Error(`Item-Tag fehlt: ${name}`);
  for (const v of json(path).values) {
    const ref = typeof v === 'string' ? v : v.id;
    if (ref.startsWith('#')) for (const i of itemTag(ref.slice(1))) out.add(i);
    else out.add(strip(ref));
  }
  return out;
}
const itemsOf = (ref) => [...(ref.startsWith('#') ? itemTag(ref.slice(1)) : [strip(ref)])].filter((i) => items.has(i)).sort();

const sets = {};
for (const path of Object.keys(files).filter((f) => f.startsWith('data/minecraft/tags/enchantment/exclusive_set/'))) {
  sets[path.split('/').pop().slice(0, -5)] = json(path).values.map(strip);
}
const curses = new Set(json('data/minecraft/tags/enchantment/curse.json').values.map(strip));

const enchantments = {};
for (const path of Object.keys(files).filter((f) => /^data\/minecraft\/enchantment\/[^/]+\.json$/.test(f)).sort()) {
  const id = path.split('/').pop().slice(0, -5);
  const e = json(path);
  const key = `enchantment.minecraft.${id}`;
  enchantments[id] = {
    max: e.max_level,
    n: [en[key] || id, de[key] || en[key] || id],
    items: itemsOf(e.supported_items),
    excl: e.exclusive_set ? strip(e.exclusive_set.replace(/^#/, '')).replace('exclusive_set/', '') : null,
    ...(curses.has(id) ? { curse: 1 } : {}),
  };
}

const target = join(ROOT, `data/enchantments-${version}.json`);
writeFileSync(target, JSON.stringify({ version, enchantments, sets }) + '\n');
console.log(`Verzauberungen: ${Object.keys(enchantments).length}, Ausschluss-Gruppen: ${Object.keys(sets).length} → ${target}`);
