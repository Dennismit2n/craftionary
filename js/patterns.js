// Craftionary – Muster: Banner und Schild am Webstuhl gestalten, Verzierter Krug aus Scherben; Befehle und Vorschau
// Daten aus data/patterns-<version>.json (tools/build_patterns.mjs)

export const MAX_LAYERS = 6; // so viele Muster nimmt der Webstuhl
export const POT_SIDES = ['back', 'left', 'right', 'front']; // Reihenfolge der Komponente pot_decorations
export const POT_SLOT = { back: 1, left: 3, right: 5, front: 7 }; // Feld im 3×3-Raster der Werkbank
const CHAT_LIMIT = 256;

/** Seiten, auf denen die Banner-Werkstatt erscheint: Banner, Schild, Webstuhl, Bannervorlagen */
export function isBannerPage(pat, id) {
  return id === 'shield' || id === 'loom' || bannerColor(pat, id) != null || pat.banner.some((b) => b.item === id);
}

/** Seiten, auf denen die Krug-Werkstatt erscheint: Verzierter Krug und alle Scherben */
export const isPotPage = (pat, id) => id === 'decorated_pot' || pat.sherds.includes(id);

/** Farbe eines Banner-Items: "red_banner" → "red" */
export function bannerColor(pat, id) {
  const m = /^(.+)_banner$/.exec(id);
  return m && pat.colors.includes(m[1]) ? m[1] : null;
}

export const patternById = (pat, id) => pat.banner.find((b) => b.id === id) || null;

/** Name eines Musters in einer Farbe, z. B. „Schwarzer Creeper“ */
export function patternName(pat, id, color, lang) {
  const b = patternById(pat, id);
  if (!b) return id;
  return b.n[lang === 'de' ? 1 : 0][Math.max(0, pat.colors.indexOf(color))];
}

const snbtLayers = (layers) => `[${layers.map((l) => `{pattern:"${l.p}",color:"${l.c}"}`).join(',')}]`;

export function bannerCommand(base, layers) {
  return `/give @s ${base}_banner` + (layers.length ? `[banner_patterns=${snbtLayers(layers)}]` : '');
}

/** Schild mit Banner: Grundfarbe und Muster des Banners gehen auf den Schild über */
export function shieldCommand(base, layers) {
  return `/give @s shield[base_color="${base}"` + (layers.length ? `,banner_patterns=${snbtLayers(layers)}` : '') + ']';
}

/** sides: { back, left, right, front } mit Item-IDs (Ziegel oder Scherbe) */
export function potCommand(sides) {
  const list = POT_SIDES.map((s) => sides[s] || 'brick');
  if (list.every((x) => x === 'brick')) return '/give @s decorated_pot';
  return `/give @s decorated_pot[pot_decorations=[${list.map((x) => `"${x}"`).join(',')}]]`;
}

export const tooLongForChat = (cmd) => cmd.length > CHAT_LIMIT;

/**
 * Arbeitsschritte: zuerst das Banner in der Grundfarbe, dann je Muster ein Gang am Webstuhl (Farbstoff + ggf. Vorlage).
 * Liefert [{ kind: 'craft', item }, { kind: 'loom', dye, item|null, p, c }…]
 */
export function loomSteps(pat, base, layers) {
  const steps = [{ kind: 'craft', item: `${base}_banner` }];
  for (const l of layers) steps.push({ kind: 'loom', dye: `${l.c}_dye`, item: patternById(pat, l.p)?.item || null, p: l.p, c: l.c });
  return steps;
}

/** Standard-Entwurf für eine Seite: Grundfarbe der Bannerseite, Muster der Vorlagenseite vorbelegt */
export function draftFor(pat, id, prev) {
  const d = { base: prev?.base && pat.colors.includes(prev.base) ? prev.base : 'white',
    layers: (prev?.layers || []).filter((l) => patternById(pat, l.p) && pat.colors.includes(l.c)).slice(0, MAX_LAYERS) };
  const color = bannerColor(pat, id);
  if (color) d.base = color;
  const own = pat.banner.find((b) => b.item === id);
  if (own && !d.layers.some((l) => l.p === own.id)) d.layers = [{ p: own.id, c: d.base === 'black' ? 'white' : 'black' }];
  return d;
}

/** Standard-Krug für eine Seite: auf einer Scherben-Seite zeigt die Vorderseite diese Scherbe */
export function potFor(pat, id, prev) {
  const ok = (x) => x === 'brick' || pat.sherds.includes(x);
  const d = Object.fromEntries(POT_SIDES.map((s) => [s, prev && ok(prev[s]) ? prev[s] : 'brick']));
  if (pat.sherds.includes(id) && !POT_SIDES.some((s) => d[s] === id)) d.front = id;
  return d;
}

// ------------------------------------------------------------------ Vorschau (Browser)
// Ausschnitte der Vorderseite aus den Original-Texturen (beim Laden der Texturen abgelegt, siehe textures.js)
export const FACE = { banner: [1, 1, 20, 40], shield: [1, 1, 12, 22] };

/** Muster-Ausschnitt mit Farbe multiplizieren und auf ctx legen (wie die Färbung im Spiel) */
function layer(ctx, img, rgb) {
  const { width: w, height: h } = ctx.canvas;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, w, h);
  if (rgb != null) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#' + rgb.toString(16).padStart(6, '0');
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0, w, h);
  }
  ctx.drawImage(c, 0, 0);
}

const loadImg = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });

/**
 * Banner- oder Schild-Vorderseite zeichnen. url(key) liefert die Bild-Adresse eines abgelegten Ausschnitts
 * ("pat:banner:creeper" …) oder null. Gibt false zurück, wenn Ausschnitte fehlen.
 */
export async function paintFace(canvas, kind, { base, layers }, pat, dyeColors, url) {
  const [, , w, h] = FACE[kind];
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const frame = kind === 'banner' ? 'banner_base' : 'shield_base';
  const keys = [frame, 'base', ...layers.map((l) => patternById(pat, l.p)?.tex)];
  const imgs = await Promise.all(keys.map((k) => { const u = k && url(`pat:${kind}:${k}`); return u ? loadImg(u) : null; }));
  if (imgs.some((i) => !i)) return false;
  ctx.clearRect(0, 0, w, h);
  layer(ctx, imgs[0], null);
  layer(ctx, imgs[1], dyeColors[base]);
  layers.forEach((l, i) => layer(ctx, imgs[i + 2], dyeColors[l.c]));
  return true;
}
