// Craftionary – gemeinsamer Zugriff auf Mojangs Dateien für die Daten-Werkzeuge (client.jar, Sprachdateien), mit Cache und Prüfsumme

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = (h) => `https://resources.download.minecraft.net/${h.slice(0, 2)}/${h}`;

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

export function workDir() {
  const i = process.argv.indexOf('--work');
  return resolve(i > 0 ? process.argv[i + 1] : join(ROOT, '_mc'));
}

export async function fetchCached(url, file, hash) {
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

/** Version, App-Daten, entpackte Jar-Dateien (gefiltert) und Sprachdateien en/de */
export async function loadGame(filter) {
  const work = workDir();
  const version = JSON.parse(readFileSync(join(ROOT, 'data/versions.json'), 'utf8')).default;
  const data = JSON.parse(readFileSync(join(ROOT, `data/${version}.json`), 'utf8'));
  const jar = await fetchCached(data.meta.clientUrl, join(work, `client-${version}.jar`), data.meta.clientSha1);
  const files = unzipSync(new Uint8Array(jar), { filter: (f) => f.name === 'assets/minecraft/lang/en_us.json' || filter(f.name) });
  const manifest = JSON.parse(await fetchCached(MANIFEST, join(work, 'version_manifest_v2.json'), null));
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Version ${version} nicht im Manifest`);
  const vjson = JSON.parse(await fetchCached(entry.url, join(work, `${version}.json`), entry.sha1));
  const index = JSON.parse(await fetchCached(vjson.assetIndex.url, join(work, `assetindex-${vjson.assetIndex.id}.json`), vjson.assetIndex.sha1));
  const deObj = index.objects['minecraft/lang/de_de.json'];
  const de = JSON.parse(await fetchCached(RESOURCES(deObj.hash), join(work, `de_de-${version}.json`), deObj.hash));
  const dec = new TextDecoder();
  const json = (path) => JSON.parse(dec.decode(files[path]));
  return { version, data, files, json, en: json('assets/minecraft/lang/en_us.json'), de };
}

export const strip = (s) => (typeof s === 'string' ? s.replace(/^minecraft:/, '') : s);
