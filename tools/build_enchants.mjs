// Craftionary – Verzauberungen aus der offiziellen client.jar lesen (Maximalstufe, passende Items, Ausschluss-Gruppen, Namen DE/EN)
// Aufruf: node tools/build_enchants.mjs [--work ./_mc]   → data/enchantments-<version>.json
// Braucht kein Java: Verzauberungen und Item-Tags liegen als JSON in der Jar, de_de.json kommt aus Mojangs Asset-Index.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argWork = process.argv.indexOf('--work');
const WORK = resolve(argWork > 0 ? process.argv[argWork + 1] : join(ROOT, '_mc'));
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = (h) => `https://resources.download.minecraft.net/${h.slice(0, 2)}/${h}`;

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

async function fetchCached(url, file, hash) {
  if (existsSync(file)) {
    const buf = readFileSync(file);
    if (!hash || sha1(buf) === hash) return buf;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash && sha1(buf) !== hash) throw new Error(`Prüfsumme stimmt nicht: ${url}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return buf;
}

const vs = JSON.parse(readFileSync(join(ROOT, 'data/versions.json'), 'utf8'));
const version = vs.default;
const meta = JSON.parse(readFileSync(join(ROOT, `data/${version}.json`), 'utf8')).meta;
const items = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, `data/${version}.json`), 'utf8')).items));

const jar = await fetchCached(meta.clientUrl, join(WORK, `client-${version}.jar`), meta.clientSha1);
const files = unzipSync(new Uint8Array(jar), {
  filter: (f) => /^data\/minecraft\/(enchantment\/[^/]+|tags\/(item|enchantment)\/.+)\.json$/.test(f.name) || f.name === 'assets/minecraft/lang/en_us.json',
});
const json = (path) => JSON.parse(new TextDecoder().decode(files[path]));

const manifest = JSON.parse(await fetchCached(MANIFEST, join(WORK, 'version_manifest_v2.json'), null));
const entry = manifest.versions.find((v) => v.id === version);
if (!entry) throw new Error(`Version ${version} nicht im Manifest`);
const vjson = JSON.parse(await fetchCached(entry.url, join(WORK, `${version}.json`), entry.sha1));
const index = JSON.parse(await fetchCached(vjson.assetIndex.url, join(WORK, `assetindex-${vjson.assetIndex.id}.json`), vjson.assetIndex.sha1));
const deObj = index.objects['minecraft/lang/de_de.json'];
const de = JSON.parse(await fetchCached(RESOURCES(deObj.hash), join(WORK, `de_de-${version}.json`), deObj.hash));
const en = json('assets/minecraft/lang/en_us.json');

const strip = (s) => s.replace(/^minecraft:/, '');
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

const out = { version, enchantments, sets };
const target = join(ROOT, `data/enchantments-${version}.json`);
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`Verzauberungen: ${Object.keys(enchantments).length}, Ausschluss-Gruppen: ${Object.keys(sets).length} → ${target}`);
