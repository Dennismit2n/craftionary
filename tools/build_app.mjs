// Craftionary – baut dist/pwa (installierbar, offline) und dist/artifact (Vorschau-Seite)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PWA = join(DIST, 'pwa');
const ART = join(DIST, 'artifact');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const versions = JSON.parse(read('data/versions.json'));
const dataFile = `data/${versions.default}.json`;
const enchFile = `data/enchantments-${versions.default}.json`; // aus tools/build_enchants.mjs
const srcFile = `data/sources-${versions.default}.json`; // aus tools/build_sources.mjs
const patFile = `data/patterns-${versions.default}.json`; // aus tools/build_patterns.mjs
const langDir = `data/lang-${versions.default}`; // Namenspakete aus tools/build_names.mjs, hier um die Oberflächentexte aus i18n/ ergänzt
const body = read('src/body.html');
const css = read('css/app.css');
const pkg = JSON.parse(read('package.json'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(PWA, { recursive: true });
mkdirSync(ART, { recursive: true });

// ------------------------------------------------------------------ JavaScript
await build({
  entryPoints: [join(ROOT, 'js/app.js')],
  bundle: true, splitting: true, format: 'esm', minify: true, target: ['es2020', 'safari15'],
  outdir: PWA, entryNames: 'app', chunkNames: 'chunks/[name]-[hash]', legalComments: 'none',
});
const artBuild = await build({
  entryPoints: [join(ROOT, 'js/app.js')],
  bundle: true, splitting: false, format: 'esm', minify: true, target: ['es2020', 'safari15'],
  write: false, legalComments: 'none',
});
const artJs = artBuild.outputFiles[0].text;

// ------------------------------------------------------------------ Schriften & Daten
cpSync(join(ROOT, 'fonts'), join(PWA, 'fonts'), { recursive: true });
mkdirSync(join(PWA, 'data'), { recursive: true });
cpSync(join(ROOT, dataFile), join(PWA, dataFile));
cpSync(join(ROOT, 'data/versions.json'), join(PWA, 'data/versions.json'));
cpSync(join(ROOT, enchFile), join(PWA, enchFile));
cpSync(join(ROOT, srcFile), join(PWA, srcFile));
cpSync(join(ROOT, patFile), join(PWA, patFile));
mkdirSync(join(ART, 'data'), { recursive: true });
cpSync(join(ROOT, dataFile), join(ART, dataFile));
cpSync(join(ROOT, 'data/versions.json'), join(ART, 'data/versions.json'));
cpSync(join(ROOT, enchFile), join(ART, enchFile));
cpSync(join(ROOT, srcFile), join(ART, srcFile));
cpSync(join(ROOT, patFile), join(ART, patFile));
// Sprachpakete: Namen der 12 weiteren Sprachen + Oberflächentexte (t), eine Datei je Sprache
const packCodes = readdirSync(join(ROOT, 'i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
for (const target of [PWA, ART]) mkdirSync(join(target, langDir), { recursive: true });
for (const code of packCodes) {
  const pack = JSON.parse(read(`${langDir}/${code}.json`));
  pack.t = JSON.parse(read(`i18n/${code}.json`));
  for (const target of [PWA, ART]) writeFileSync(join(target, langDir, `${code}.json`), JSON.stringify(pack));
}

// Teilmengen per unicode-range: Polnisch, Türkisch und Co. (latin-ext) und Russisch (kyrillisch, nur Pixelify) lädt der Browser nur bei Bedarf
const fontFace = `
@font-face { font-family: "Pixelify Sans"; font-weight: 500; font-display: swap; src: url(fonts/pixelify-sans-latin-500-normal.woff2) format("woff2"); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: "Pixelify Sans"; font-weight: 500; font-display: swap; src: url(fonts/pixelify-sans-latin-ext-500-normal.woff2) format("woff2"); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: "Pixelify Sans"; font-weight: 500; font-display: swap; src: url(fonts/pixelify-sans-cyrillic-500-normal.woff2) format("woff2"); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: "Pixelify Sans"; font-weight: 600; font-display: swap; src: url(fonts/pixelify-sans-latin-600-normal.woff2) format("woff2"); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: "Pixelify Sans"; font-weight: 600; font-display: swap; src: url(fonts/pixelify-sans-latin-ext-600-normal.woff2) format("woff2"); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: "Pixelify Sans"; font-weight: 600; font-display: swap; src: url(fonts/pixelify-sans-cyrillic-600-normal.woff2) format("woff2"); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: "Atkinson Hyperlegible Next"; font-weight: 400; font-display: swap; src: url(fonts/atkinson-hyperlegible-next-latin-400-normal.woff2) format("woff2"); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: "Atkinson Hyperlegible Next"; font-weight: 400; font-display: swap; src: url(fonts/atkinson-hyperlegible-next-latin-ext-400-normal.woff2) format("woff2"); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: "Atkinson Hyperlegible Next"; font-weight: 700; font-display: swap; src: url(fonts/atkinson-hyperlegible-next-latin-700-normal.woff2) format("woff2"); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: "Atkinson Hyperlegible Next"; font-weight: 700; font-display: swap; src: url(fonts/atkinson-hyperlegible-next-latin-ext-700-normal.woff2) format("woff2"); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
`;
writeFileSync(join(PWA, 'app.css'), fontFace + css);

// ------------------------------------------------------------------ App-Icons (eigenes Motiv)
const iconSvg = (maskable) => {
  const cell = 100, gap = 22, start = (512 - (3 * cell + 2 * gap)) / 2;
  const colors = { '0,0': '#c8693a', '1,1': '#c8693a', '2,2': '#4fa391' };
  let cells = '';
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const cx = start + x * (cell + gap), cy = start + y * (cell + gap);
    const fill = colors[`${x},${y}`] || '#b9c0c4';
    cells += `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" rx="10" fill="${fill}"/>`
      + `<rect x="${cx}" y="${cy}" width="${cell}" height="12" rx="6" fill="#ffffff" opacity=".28"/>`
      + `<rect x="${cx}" y="${cy + cell - 12}" width="${cell}" height="12" rx="6" fill="#000000" opacity=".22"/>`;
  }
  const scale = maskable ? 0.72 : 0.86;
  const off = (512 - 512 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
    + (maskable ? '<rect width="512" height="512" fill="#20262b"/>' : '<rect width="512" height="512" rx="104" fill="#20262b"/>')
    + `<g transform="translate(${off} ${off}) scale(${scale})">${cells}</g></svg>`;
};
mkdirSync(join(PWA, 'icons'), { recursive: true });
writeFileSync(join(PWA, 'icons/icon.svg'), iconSvg(false));
// PNG-Icons liegen fertig in icons/ (eingecheckt). Fehlen sie, werden sie mit sharp neu erzeugt und dort abgelegt.
const PNGS = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true], ['favicon-32.png', 32, false]];
const STORED = join(ROOT, 'icons');
if (!PNGS.every(([name]) => existsSync(join(STORED, name)))) {
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch {
    try { sharp = (await import('/opt/npm-tools/node_modules/sharp/dist/index.cjs')).default; } catch { sharp = null; }
  }
  if (!sharp) throw new Error('App-Icons fehlen in icons/ und sharp ist nicht installiert (npm i -D sharp)');
  mkdirSync(STORED, { recursive: true });
  for (const [name, size, mask] of PNGS) await sharp(Buffer.from(iconSvg(mask))).resize(size, size).png().toFile(join(STORED, name));
}
for (const [name] of PNGS) cpSync(join(STORED, name), join(PWA, 'icons', name));

const manifest = {
  id: './',
  name: 'Craftionary',
  short_name: 'Craftionary',
  description: 'Rezept-Kompendium für Minecraft Java: fehlertolerante Suche in 14 Sprachen, alle Stationen, offline.',
  lang: 'de',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#171b1f',
  theme_color: '#20262b',
  categories: ['games', 'utilities', 'education'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
};
writeFileSync(join(PWA, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// ------------------------------------------------------------------ index.html (PWA)
const head = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Craftionary</title>
<meta name="description" content="${manifest.description}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#20262b">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f8f7">
<meta name="color-scheme" content="light dark">
<script>try{var r=document.documentElement,m=window.matchMedia,v=localStorage.getItem('werkstatt.darstellung'),t=null,s=null;if(!v)v=JSON.parse(localStorage.getItem('craftionary.theme'));if(v==='light'||v==='dark')t=v;else if(v==='hc-dark'||v==='hc-light'){t=v.slice(3);s='contrast'}else if(v==='cvd-dark'||v==='cvd-light'){t=v.slice(4);s='cvd'}else if(v==='invert')s='invert';else if(typeof v==='string'&&/dark/.test(v))t='dark';else if(typeof v==='string'&&/light/.test(v))t='light';else if(m&&m('(prefers-contrast: more)').matches){t=m('(prefers-color-scheme: dark)').matches?'dark':'light';s='contrast'}if(t)r.setAttribute('data-theme',t);if(s)r.setAttribute('data-vision',s)}catch(e){}
addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.cfInstall=e;if(window.cfOnInstall)window.cfOnInstall()});</script>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Craftionary">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="preload" href="fonts/pixelify-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${dataFile}" as="fetch" crossorigin>
<link rel="stylesheet" href="app.css">
<script type="module" src="app.js"></script>
</head>
<body>
${body}
<noscript><p style="padding:16px">Craftionary braucht JavaScript. · Craftionary needs JavaScript.</p></noscript>
</body>
</html>
`;
writeFileSync(join(PWA, 'index.html'), head);

// ------------------------------------------------------------------ Service Worker
const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(PWA, p).split('\\').join('/'));
  }
};
walk(PWA);
// Sprachpakete lädt jedes Gerät nur für die gewählte Sprache (Zwischenspeicher beim ersten Abruf)
const precache = ['./', ...files.filter((f) => !f.endsWith('.txt') && f !== 'sw.js' && !f.startsWith('data/lang-'))];
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(PWA, f)));
const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
const sw = `// Craftionary Service Worker – offline-fähig, Cache je Version
const CACHE = 'craftionary-${version}';
const PRECACHE = ${JSON.stringify(precache)};
const LANG_DIR = '${langDir}/';
self.addEventListener('install', (e) => {
  // cache: 'reload' am HTTP-Cache vorbei, sonst landen nach einem Deploy (Pages: max-age=600) alte Dateien im neuen Cache
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    // Schon benutzte Sprachpakete gleich neu mitnehmen, sonst fehlen sie nach dem Update ohne Netz
    const langs = new Set();
    for (const k of await caches.keys()) {
      if (!k.startsWith('craftionary-') || k === CACHE) continue;
      for (const r of await (await caches.open(k)).keys()) {
        const p = new URL(r.url).pathname;
        if (p.includes('/data/lang-') && p.endsWith('.json')) langs.add(p.slice(p.lastIndexOf('/') + 1, -5));
      }
    }
    await Promise.all([...langs].map((l) => c.add(new Request(LANG_DIR + l + '.json', { cache: 'reload' })).catch(() => {})));
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('craftionary-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // z. B. Mojang-Download nicht cachen
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./', { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
`;
writeFileSync(join(PWA, 'sw.js'), sw);

// ------------------------------------------------------------------ Vorschau-Seite (Artifact)
const fonts = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700&family=Pixelify+Sans:wght@500;600&display=swap';
const art = `<title>Craftionary</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
${body}
<script>window.CRAFTIONARY_NO_SW = true; window.CRAFTIONARY_PREVIEW = true;</script>
<script type="module">
${artJs}
</script>
`;
writeFileSync(join(ART, 'index.html'), art);
for (const f of ['README.md', 'LICENSE']) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(PWA, f));
writeFileSync(join(PWA, '.nojekyll'), ''); // GitHub Pages: Dateien unverändert ausliefern
console.log('PWA:', files.length + 1, 'Dateien · Version', version);
console.log('Vorschau:', Math.round(art.length / 1024), 'KB HTML');
