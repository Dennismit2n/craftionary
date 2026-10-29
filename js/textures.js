// Craftionary – Original-Texturen: Spiel-Jar laden (von Mojang oder aus einer Datei), Modelle lesen,
// Icons wie im Inventar zeichnen. Läuft komplett im Browser; es werden keine Grafiken mitgeliefert.

import { unzip, unzipSync } from 'fflate';

const NEED = /^(version\.json|assets\/minecraft\/(items|models)\/.+\.json|assets\/minecraft\/textures\/(item|block|entity|colormap)\/.+\.(png|mcmeta))$/;
const SIZE = 128; // Pixel je Icon (8 Bildschirmpixel pro Texel)
const DEG = Math.PI / 180;

// Lichtrichtungen der Spiel-GUI (Lighting + RenderSystem, siehe tools/README): Seitenlicht für Blöcke, Frontlicht für flache Modelle
const LIGHT_SIDE = [[-0.93344, 0.26269, -0.2443], [-0.10357, 0.97661, 0.18845]];
const LIGHT_FRONT = [[-0.22252, -0.1715, 0.95973], [-0.21501, -0.97183, 0.09657]];

function codeError(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
const strip = (s) => (typeof s === 'string' && s.startsWith('minecraft:') ? s.slice(10) : s);

// ============================================================================ Einstieg
export async function importTextures(db, src, progress = () => {}) {
  let bytes;
  if (src.file) {
    bytes = new Uint8Array(await src.file.arrayBuffer());
  } else {
    bytes = await download(db.meta, progress);
  }
  progress('unpack');
  let files;
  try { files = await unpack(bytes); } catch (e) { throw codeError('WRONG_FILE', e && e.message); }
  if (!files.has('assets/minecraft/items/stone.json')) throw codeError('WRONG_FILE');
  let version = db.meta.version;
  try { version = JSON.parse(new TextDecoder().decode(files.get('version.json'))).id || version; } catch { /* egal */ }
  const assets = new Assets(files);
  const r = new Renderer(assets, db);
  const ids = Object.keys(db.items).filter((id) => id !== 'air' && !db.items[id].group);
  const icons = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      const canvas = await r.renderItem(id);
      if (canvas) icons.set(id, await toBlob(canvas));
    } catch (e) {
      console.warn('[icons]', id, e);
    }
    if (i % 24 === 0) {
      progress('render', i, ids.length);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  progress('render', ids.length, ids.length);
  return { icons, version };
}

async function download(meta, progress) {
  let res;
  try {
    res = await fetch(meta.clientUrl, { mode: 'cors', cache: 'no-store' });
  } catch (e) {
    throw codeError('BLOCKED', e.message);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || meta.clientSize;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    progress('download', Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  if (meta.clientSha1 && crypto.subtle) {
    const h = await crypto.subtle.digest('SHA-1', out);
    const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== meta.clientSha1) throw new Error('Prüfsumme stimmt nicht – Download beschädigt');
  }
  return out;
}

function unpack(bytes) {
  const filter = (f) => NEED.test(f.name);
  const sync = () => new Map(Object.entries(unzipSync(bytes, { filter })));
  return new Promise((resolve, reject) => {
    try {
      unzip(bytes, { filter }, (err, out) => {
        if (err) { try { resolve(sync()); } catch (e2) { reject(e2); } return; }
        resolve(new Map(Object.entries(out)));
      });
    } catch {
      try { resolve(sync()); } catch (e2) { reject(e2); }
    }
  });
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

// ============================================================================ Ressourcen
class Assets {
  constructor(files) {
    this.files = files;
    this.jsonCache = new Map();
    this.texCache = new Map();
    this.tintCache = new Map();
    this.modelCache = new Map();
    this.dec = new TextDecoder();
  }

  json(path) {
    if (this.jsonCache.has(path)) return this.jsonCache.get(path);
    const b = this.files.get(path);
    let v = null;
    if (b) { try { v = JSON.parse(this.dec.decode(b)); } catch { v = null; } }
    this.jsonCache.set(path, v);
    return v;
  }

  itemDef(id) { return this.json(`assets/minecraft/items/${id}.json`); }

  /** Textur laden, bei Animationen nur das erste Bild. ref: "block/stone", "minecraft:item/stick", "entity/chest/normal" */
  async texture(ref, { full = false } = {}) {
    const key = strip(ref) + (full ? '|full' : '');
    if (this.texCache.has(key)) return this.texCache.get(key);
    const p = (async () => {
      const path = `assets/minecraft/textures/${strip(ref)}.png`;
      const bytes = this.files.get(path);
      if (!bytes) return null;
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      let w = bmp.width, h = bmp.height, sy = 0;
      if (!full) {
        const meta = this.json(path + '.mcmeta');
        const anim = meta && meta.animation;
        if (anim || h > w) {
          const fw = (anim && anim.width) || w;
          const fh = (anim && anim.height) || fw;
          let idx = 0;
          if (anim && Array.isArray(anim.frames) && anim.frames.length) {
            const f = anim.frames[0];
            idx = typeof f === 'number' ? f : (f.index || 0);
          }
          const perRow = Math.max(1, Math.floor(w / fw));
          sy = Math.floor(idx / perRow) * fh;
          w = fw; h = fh;
        }
      }
      const c = makeCanvas(w, h);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, w, h, 0, 0, w, h);
      if (sy) { g.clearRect(0, 0, w, h); g.drawImage(bmp, 0, sy, w, h, 0, 0, w, h); }
      bmp.close?.();
      return c;
    })();
    this.texCache.set(key, p);
    return p;
  }

  /** Textur mit Farbe multipliziert (Tönung × Schattierung) */
  async tinted(ref, rgb, opts) {
    const key = `${strip(ref)}|${rgb}|${opts && opts.full ? 'f' : ''}`;
    if (this.tintCache.has(key)) return this.tintCache.get(key);
    const p = (async () => {
      const base = await this.texture(ref, opts);
      if (!base) return null;
      if (rgb === 0xffffff) return base;
      const c = makeCanvas(base.width, base.height);
      const g = c.getContext('2d');
      g.drawImage(base, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = '#' + rgb.toString(16).padStart(6, '0');
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(base, 0, 0);
      return c;
    })();
    this.tintCache.set(key, p);
    return p;
  }

  /** Einzelnes Pixel (z. B. aus der Farbkarte für Gras/Laub). Die Bilddaten werden je Textur nur einmal ausgelesen. */
  async pixel(ref, x, y) {
    const key = strip(ref);
    this.pixCache ??= new Map();
    let img = this.pixCache.get(key);
    if (!img) {
      const t = await this.texture(ref, { full: true });
      if (!t) return null;
      img = t.getContext('2d').getImageData(0, 0, t.width, t.height);
      this.pixCache.set(key, img);
    }
    const i = (Math.min(img.height - 1, y) * img.width + Math.min(img.width - 1, x)) * 4;
    return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
  }

  /** Modell mit allen Eltern auflösen */
  model(ref) {
    const id = strip(ref);
    if (this.modelCache.has(id)) return this.modelCache.get(id);
    const chain = [];
    let cur = id;
    let generated = false;
    for (let i = 0; cur && i < 30; i++) {
      if (cur === 'builtin/generated') { generated = true; break; }
      if (cur.startsWith('builtin/')) break;
      const j = this.json(`assets/minecraft/models/${cur}.json`);
      if (!j) break;
      chain.push(j);
      cur = strip(j.parent);
    }
    const m = { textures: {}, elements: null, display: {}, guiLight: null, generated };
    for (let i = chain.length - 1; i >= 0; i--) {
      const j = chain[i];
      if (j.textures) Object.assign(m.textures, j.textures);
      if (j.display) for (const [k, v] of Object.entries(j.display)) m.display[k] = { ...(m.display[k] || {}), ...v };
      if (j.elements) m.elements = j.elements;
      if (j.gui_light) m.guiLight = j.gui_light;
    }
    if (m.elements) m.generated = false;
    this.modelCache.set(id, m);
    return m;
  }

  resolveTex(textures, name) {
    let v = name;
    for (let i = 0; i < 12 && typeof v === 'string'; i++) {
      // heavy_core.json verweist mit "all" statt "#all": ein Name aus der Textur-Tabelle zählt auch ohne # als Verweis
      const slot = v.startsWith('#') ? v.slice(1) : (textures && Object.hasOwn(textures, v) ? v : null);
      if (slot == null) break;
      v = textures[slot];
    }
    if (typeof v === 'object' && v) v = v.sprite;
    return typeof v === 'string' ? v : null;
  }
}

// ============================================================================ Mathe
const mat = {
  id: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul: (a, b) => {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  },
  rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
  rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  scale: (x, y, z) => [x, 0, 0, 0, y, 0, 0, 0, z],
  apply: (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]],
  quat: ([x, y, z, w]) => [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
};

/** Affine Abbildung (3×3 linear + Verschiebung) */
class Affine {
  constructor(m = mat.id(), t = [0, 0, 0]) { this.m = m; this.t = t; }
  then(o) { // erst this, dann o
    return new Affine(mat.mul(o.m, this.m), mat.apply(o.m, this.t).map((v, i) => v + o.t[i]));
  }
  apply(v) { const r = mat.apply(this.m, v); return [r[0] + this.t[0], r[1] + this.t[1], r[2] + this.t[2]]; }
  static translate(x, y, z) { return new Affine(mat.id(), [x, y, z]); }
  static linear(m) { return new Affine(m, [0, 0, 0]); }
}

function quatFrom(q) {
  if (!q) return mat.id();
  if (Array.isArray(q)) return mat.quat(q);
  if (q.axis && q.angle != null) { // Achse-Winkel
    const [x, y, z] = q.axis; const a = q.angle * DEG / 2; const s = Math.sin(a);
    return mat.quat([x * s, y * s, z * s, Math.cos(a)]);
  }
  return mat.id();
}

/** "transformation" aus der Item-Definition: T · L · S · R */
function transformationAffine(t) {
  if (!t) return new Affine();
  if (Array.isArray(t)) return new Affine([t[0], t[1], t[2], t[4], t[5], t[6], t[8], t[9], t[10]], [t[3], t[7], t[11]]);
  const L = quatFrom(t.left_rotation);
  const R = quatFrom(t.right_rotation);
  const s = t.scale || [1, 1, 1];
  const m = mat.mul(L, mat.mul(mat.scale(s[0], s[1], s[2]), R));
  return new Affine(m, t.translation || [0, 0, 0]);
}

/** Anzeige-Transformation (display.gui) */
function displayAffine(d) {
  const r = (d && d.rotation) || [0, 0, 0];
  const t = (d && d.translation) || [0, 0, 0];
  const s = (d && d.scale) || [1, 1, 1];
  const R = mat.mul(mat.rx(r[0] * DEG), mat.mul(mat.ry(r[1] * DEG), mat.rz(r[2] * DEG)));
  const m = mat.mul(R, mat.scale(s[0], s[1], s[2]));
  const clamp = (v) => Math.max(-80, Math.min(80, v)) / 16;
  return new Affine(m, [clamp(t[0]), clamp(t[1]), clamp(t[2])]);
}

// ============================================================================ Blockmodell → Vierecke
const FACE_VERTS = {
  down: (a, b) => [[a[0], a[1], b[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]]],
  up: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [b[0], b[1], b[2]], [b[0], b[1], a[2]]],
  north: (a, b) => [[b[0], b[1], a[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]], [a[0], b[1], a[2]]],
  south: (a, b) => [[a[0], b[1], b[2]], [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]]],
  west: (a, b) => [[a[0], b[1], a[2]], [a[0], a[1], a[2]], [a[0], a[1], b[2]], [a[0], b[1], b[2]]],
  east: (a, b) => [[b[0], b[1], b[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]]],
};
const DEFAULT_UV = {
  down: (a, b) => [a[0], 16 - b[2], b[0], 16 - a[2]],
  up: (a, b) => [a[0], a[2], b[0], b[2]],
  north: (a, b) => [16 - b[0], 16 - b[1], 16 - a[0], 16 - a[1]],
  south: (a, b) => [a[0], 16 - b[1], b[0], 16 - a[1]],
  west: (a, b) => [a[2], 16 - b[1], b[2], 16 - a[1]],
  east: (a, b) => [16 - b[2], 16 - b[1], 16 - a[2], 16 - a[1]],
};

function elementRotation(rot) {
  if (!rot) return null;
  const o = rot.origin || [8, 8, 8];
  let m, scale = [1, 1, 1];
  if (rot.axis) {
    const a = (rot.angle || 0) * DEG;
    m = rot.axis === 'x' ? mat.rx(a) : rot.axis === 'y' ? mat.ry(a) : mat.rz(a);
    if (rot.rescale && Math.abs(Math.cos(a)) > 1e-6) {
      const f = 1 / Math.cos(a);
      scale = rot.axis === 'x' ? [1, f, f] : rot.axis === 'y' ? [f, 1, f] : [f, f, 1];
    }
  } else {
    m = mat.mul(mat.rx((rot.x || 0) * DEG), mat.mul(mat.ry((rot.y || 0) * DEG), mat.rz((rot.z || 0) * DEG)));
  }
  return (p) => {
    const r = mat.apply(m, [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
    return [r[0] * scale[0] + o[0], r[1] * scale[1] + o[1], r[2] * scale[2] + o[2]];
  };
}

/** Vierecke eines Blockmodells in Blockeinheiten (0…1) */
function blockQuads(assets, model, tints) {
  const quads = [];
  for (const el of model.elements || []) {
    const a = el.from, b = el.to;
    const rotate = elementRotation(el.rotation);
    for (const [dir, face] of Object.entries(el.faces || {})) {
      const mk = FACE_VERTS[dir];
      if (!mk) continue;
      const tex = assets.resolveTex(model.textures, face.texture);
      if (!tex) continue;
      let verts = mk(a, b);
      if (rotate) verts = verts.map(rotate);
      const uv = face.uv || DEFAULT_UV[dir](a, b);
      const corners = [[uv[0], uv[1]], [uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]]];
      const sh = ((face.rotation || 0) / 90) & 3;
      quads.push({
        p: verts.map((v) => [v[0] / 16, v[1] / 16, v[2] / 16]),
        uv: [0, 1, 2, 3].map((i) => corners[(i + sh) % 4]),
        uvUnit: 16, // UV in 1/16 der Textur
        tex,
        tint: face.tintindex != null ? (tints[face.tintindex] ?? null) : null,
        shade: el.shade !== false,
      });
    }
  }
  return quads;
}

/** Flaches Item (item/generated): ein Viereck je Ebene, in Blickrichtung */
function generatedQuads(model, tints) {
  const quads = [];
  for (let i = 0; i < 8; i++) {
    const tex = model.textures['layer' + i];
    if (!tex) continue;
    const z = 8 / 16 + i * 0.0005;
    quads.push({
      p: [[0, 1, z], [0, 0, z], [1, 0, z], [1, 1, z]],
      uv: [[0, 0], [0, 16], [16, 16], [16, 0]],
      uvUnit: 16,
      tex: tex.startsWith('#') ? model.textures[tex.slice(1)] : tex,
      tint: tints[i] ?? null,
      shade: false,
      layer: i,
    });
  }
  return quads;
}

// ============================================================================ Kreaturmodelle (Truhe, Shulker, Banner, Schild, Köpfe …)
/**
 * Würfel wie in net.minecraft.client.model.geom.ModelPart.Cube (UV-Abwicklung inklusive).
 * Einheiten: Pixel (1/16 Block). Liefert Vierecke mit Textur-UV in Pixeln.
 */
function entityCube({ u, v, x, y, z, w, h, d, g = 0, tex, texW, texH, only = null }) {
  const x1 = x - g, y1 = y - g, z1 = z - g, x2 = x + w + g, y2 = y + h + g, z2 = z + d + g;
  const V = {
    0: [x1, y1, z1], 1: [x2, y1, z1], 2: [x2, y2, z1], 3: [x1, y2, z1],
    4: [x1, y1, z2], 5: [x2, y1, z2], 6: [x2, y2, z2], 7: [x1, y2, z2],
  };
  const f4 = u, f5 = u + d, f6 = u + d + w, f7 = u + d + w + w, f8 = u + d + w + d, f9 = u + d + w + d + w;
  const f10 = v, f11 = v + d, f12 = v + d + h;
  const polys = {
    down: [[5, 4, 0, 1], f5, f10, f6, f11],
    up: [[2, 3, 7, 6], f6, f11, f7, f10],
    west: [[0, 4, 7, 3], f4, f11, f5, f12],
    north: [[1, 0, 3, 2], f5, f11, f6, f12],
    east: [[5, 1, 2, 6], f6, f11, f8, f12],
    south: [[4, 5, 6, 7], f8, f11, f9, f12],
  };
  const quads = [];
  for (const [dir, [vi, U1, V1, U2, V2]] of Object.entries(polys)) {
    if (only && !only.includes(dir)) continue;
    if ((dir === 'down' || dir === 'up') && (w === 0 || d === 0)) continue;
    if ((dir === 'west' || dir === 'east') && (h === 0 || d === 0)) continue;
    if ((dir === 'north' || dir === 'south') && (w === 0 || h === 0)) continue;
    quads.push({
      p: vi.map((i) => V[i]),
      // Polygon: Ecke 0 → (u2,v1), 1 → (u1,v1), 2 → (u1,v2), 3 → (u2,v2)
      uv: [[U2, V1], [U1, V1], [U1, V2], [U2, V2]],
      uvUnit: 0, tex, texW, texH, tint: null, shade: true,
    });
  }
  return quads;
}

/** Teil mit Position/Drehung (ModelPart.translateAndRotate): T · Rz · Ry · Rx */
function part(quads, { x = 0, y = 0, z = 0, xr = 0, yr = 0, zr = 0 } = {}) {
  const m = mat.mul(mat.rz(zr), mat.mul(mat.ry(yr), mat.rx(xr)));
  return quads.map((q) => ({ ...q, p: q.p.map((v) => { const r = mat.apply(m, v); return [r[0] + x, r[1] + y, r[2] + z]; }) }));
}

const toBlock = (quads) => quads.map((q) => ({ ...q, p: q.p.map((v) => [v[0] / 16, v[1] / 16, v[2] / 16]) }));

/** "minecraft:textures/entity/x.png" → "entity/x" */
const texRef = (s) => (typeof s === 'string' ? strip(s).replace(/^textures\//, '').replace(/\.png$/, '') : null);

function specialQuads(spec, db) {
  const t = strip(spec.type);
  switch (t) {
    case 'chest': {
      const tex = `entity/chest/${strip(spec.texture || 'normal')}`;
      const T = { tex, texW: 64, texH: 64 };
      return toBlock([
        ...entityCube({ ...T, u: 0, v: 19, x: 1, y: 0, z: 1, w: 14, h: 10, d: 14 }),
        ...part(entityCube({ ...T, u: 0, v: 0, x: 1, y: 0, z: 0, w: 14, h: 5, d: 14 }), { y: 9, z: 1 }),
        ...part(entityCube({ ...T, u: 0, v: 0, x: 7, y: -2, z: 14, w: 2, h: 4, d: 1 }), { y: 9, z: 1 }),
      ]);
    }
    case 'shulker_box': {
      const tex = `entity/shulker/${strip(spec.texture || 'shulker')}`;
      const T = { tex, texW: 64, texH: 64 };
      return toBlock([
        ...part(entityCube({ ...T, u: 0, v: 0, x: -8, y: -16, z: -8, w: 16, h: 12, d: 16 }), { y: 24 }),
        ...part(entityCube({ ...T, u: 0, v: 28, x: -8, y: -8, z: -8, w: 16, h: 8, d: 16 }), { y: 24 }),
      ]);
    }
    case 'banner': {
      const color = (db.data.dyeColors || {})[spec.color] ?? 0xffffff;
      const wood = { tex: 'entity/banner/banner_base', texW: 64, texH: 64 };
      const flag = [
        ...entityCube({ ...wood, u: 0, v: 0, x: -10, y: 0, z: -2, w: 20, h: 40, d: 1 }),
      ];
      const flagTint = entityCube({ tex: 'entity/banner/base', texW: 64, texH: 64, u: 0, v: 0, x: -10, y: 0, z: -2.002, w: 20, h: 40, d: 1.004 })
        .map((q) => ({ ...q, tint: color, order: 1 }));
      return toBlock([
        ...entityCube({ ...wood, u: 44, v: 0, x: -1, y: -42, z: -1, w: 2, h: 42, d: 2 }),
        ...entityCube({ ...wood, u: 0, v: 42, x: -10, y: -44, z: -1, w: 20, h: 2, d: 2 }),
        ...part([...flag, ...flagTint], { y: -44 }),
      ]);
    }
    case 'shield': {
      const T = { tex: 'entity/shield/shield_base_nopattern', texW: 64, texH: 64 };
      return toBlock([
        ...entityCube({ ...T, u: 0, v: 0, x: -6, y: -11, z: -2, w: 12, h: 22, d: 1 }),
        ...entityCube({ ...T, u: 26, v: 0, x: -1, y: -3, z: -1, w: 2, h: 6, d: 6 }),
      ]);
    }
    case 'head': {
      const kind = strip(spec.kind);
      const map = {
        skeleton: ['entity/skeleton/skeleton', 64, 32, false], wither_skeleton: ['entity/skeleton/wither_skeleton', 64, 32, false],
        zombie: ['entity/zombie/zombie', 64, 64, true], creeper: ['entity/creeper/creeper', 64, 32, false],
        piglin: ['entity/piglin/piglin', 64, 64, false],
      };
      const m = map[kind];
      if (!m) return null;
      const T = { tex: m[0], texW: m[1], texH: m[2] };
      if (kind === 'piglin') {
        return toBlock([
          ...entityCube({ ...T, u: 0, v: 0, x: -5, y: -8, z: -4, w: 10, h: 8, d: 8 }),
          ...entityCube({ ...T, u: 31, v: 1, x: -2, y: -4, z: -5, w: 4, h: 4, d: 1 }),
          ...part(entityCube({ ...T, u: 51, v: 6, x: 0, y: 0, z: -2, w: 1, h: 5, d: 4 }), { x: 4.5, y: -6, zr: -30 * DEG }),
          ...part(entityCube({ ...T, u: 39, v: 6, x: -1, y: 0, z: -2, w: 1, h: 5, d: 4 }), { x: -4.5, y: -6, zr: 30 * DEG }),
        ]);
      }
      const q = entityCube({ ...T, u: 0, v: 0, x: -4, y: -8, z: -4, w: 8, h: 8, d: 8 });
      if (m[3]) q.push(...entityCube({ ...T, u: 32, v: 0, x: -4, y: -8, z: -4, w: 8, h: 8, d: 8, g: 0.25 }).map((x) => ({ ...x, order: 1 })));
      return toBlock(q);
    }
    case 'player_head': {
      const T = { tex: 'entity/player/wide/steve', texW: 64, texH: 64 };
      return toBlock([
        ...entityCube({ ...T, u: 0, v: 0, x: -4, y: -8, z: -4, w: 8, h: 8, d: 8 }),
        ...entityCube({ ...T, u: 32, v: 0, x: -4, y: -8, z: -4, w: 8, h: 8, d: 8, g: 0.25 }).map((x) => ({ ...x, order: 1 })),
      ]);
    }
    case 'conduit': {
      const T = { tex: 'entity/conduit/base', texW: 32, texH: 16 };
      return toBlock(entityCube({ ...T, u: 0, v: 0, x: -3, y: -3, z: -3, w: 6, h: 6, d: 6 }));
    }
    case 'copper_golem_statue': {
      // CopperGolemModel.createBodyLayer (Pose „standing“); die Statue setzt die Wurzel auf y = 0 und dreht sie um 180° um Z
      const T = { tex: texRef(spec.texture) || 'entity/copper_golem/copper_golem', texW: 64, texH: 64 };
      const head = part([
        ...entityCube({ ...T, u: 0, v: 0, x: -4, y: -5, z: -5, w: 8, h: 5, d: 10, g: 0.015 }),
        ...entityCube({ ...T, u: 56, v: 0, x: -1, y: -2, z: -6, w: 2, h: 3, d: 2 }),
        ...entityCube({ ...T, u: 37, v: 8, x: -1, y: -9, z: -1, w: 2, h: 4, d: 2, g: -0.015 }),
        ...entityCube({ ...T, u: 37, v: 0, x: -2, y: -13, z: -2, w: 4, h: 4, d: 4, g: -0.015 }),
      ], { y: -6 });
      const rightArm = part(entityCube({ ...T, u: 36, v: 16, x: -3, y: -1, z: -2, w: 3, h: 10, d: 4 }), { x: -4, y: -6 });
      const leftArm = part(entityCube({ ...T, u: 50, v: 16, x: 0, y: -1, z: -2, w: 3, h: 10, d: 4 }), { x: 4, y: -6 });
      const body = part([...entityCube({ ...T, u: 0, v: 15, x: -4, y: -6, z: -3, w: 8, h: 6, d: 6 }), ...head, ...rightArm, ...leftArm], { y: -5 });
      const legs = part([
        ...entityCube({ ...T, u: 0, v: 27, x: -4, y: 0, z: -2, w: 4, h: 5, d: 4 }),
        ...entityCube({ ...T, u: 16, v: 27, x: 0, y: 0, z: -2, w: 4, h: 5, d: 4 }),
      ], { y: -5 });
      return toBlock(part([...body, ...legs], { zr: Math.PI }));
    }
    case 'decorated_pot': {
      const base = { tex: 'entity/decorated_pot/decorated_pot_base', texW: 32, texH: 32 };
      const side = { tex: 'entity/decorated_pot/decorated_pot_side', texW: 16, texH: 16 };
      const sides = [];
      // vier Seitenflächen (je 14×16) wie im Spiel um den Topf
      const sideFace = (pose) => part(entityCube({ ...side, u: 1, v: 0, x: 0, y: 0, z: 0, w: 14, h: 16, d: 0, only: ['north'] }), pose);
      sides.push(...sideFace({ x: 15, y: 16, z: 1, zr: Math.PI }));
      sides.push(...sideFace({ x: 1, y: 16, z: 1, yr: -Math.PI / 2, zr: Math.PI }));
      sides.push(...sideFace({ x: 15, y: 16, z: 15, yr: Math.PI / 2, zr: Math.PI }));
      sides.push(...sideFace({ x: 1, y: 16, z: 15, xr: Math.PI }));
      const neck = part([
        ...entityCube({ ...base, u: 0, v: 0, x: 4, y: 17, z: 4, w: 8, h: 3, d: 8, g: -0.1 }),
        ...entityCube({ ...base, u: 0, v: 5, x: 5, y: 20, z: 5, w: 6, h: 1, d: 6, g: 0.2 }),
      ], { x: 0, y: 37, z: 16, xr: Math.PI });
      const lid = (y) => part(entityCube({ ...base, u: -14, v: 13, x: 0, y: 0, z: 0, w: 14, h: 0, d: 14 }), { x: 1, y, z: 1 });
      return toBlock([...sides, ...neck, ...lid(16), ...lid(0)]);
    }
    default:
      return null;
  }
}

// ============================================================================ Zeichnen
class Renderer {
  constructor(assets, db) {
    this.a = assets;
    this.db = db;
  }

  async grassColor(temp, downfall) {
    const t = Math.min(1, Math.max(0, temp));
    const d = Math.min(1, Math.max(0, downfall)) * t;
    const c = await this.a.pixel('colormap/grass', Math.floor((1 - t) * 255), Math.floor((1 - d) * 255));
    return c ?? 0x7cbd6b;
  }

  async tintColor(tint, ctx) {
    const type = strip(tint.type);
    switch (type) {
      case 'constant': return tint.value & 0xffffff;
      case 'grass': return this.grassColor(tint.temperature ?? 0.5, tint.downfall ?? 1);
      case 'potion': return (ctx.potionColor ?? tint.default ?? -13083194) & 0xffffff;
      default: return (tint.default ?? -1) & 0xffffff;
    }
  }

  /** Item-Definition durchgehen und Ebenen sammeln. Transformationen gelten für alle Kinder eines Knotens. */
  collect(node, out, outer = null) {
    if (!node) return;
    const type = strip(node.type);
    // innen zuerst, dann außen: v' = Außen(Innen(v))
    const here = node.transformation ? transformationAffine(node.transformation) : null;
    const tr = here && outer ? here.then(outer) : (here || outer);
    switch (type) {
      case 'model': out.push({ kind: 'model', model: node.model, tints: node.tints || [], transform: tr }); break;
      case 'composite': for (const m of node.models || []) this.collect(m, out, tr); break;
      case 'condition': this.collect(node.on_false, out, tr); break;
      case 'select': {
        const prop = strip(node.property);
        let pick = null;
        if (prop === 'display_context') pick = (node.cases || []).find((c) => [].concat(c.when).includes('gui'));
        else if (prop === 'context_dimension') pick = (node.cases || []).find((c) => [].concat(c.when).some((w) => strip(w) === 'overworld'));
        this.collect(pick ? pick.model : (node.fallback || (node.cases && node.cases[0] && node.cases[0].model)), out, tr);
        break;
      }
      case 'range_dispatch': this.collect(node.fallback || (node.entries && node.entries[0] && node.entries[0].model), out, tr); break;
      case 'special': out.push({ kind: 'special', spec: node.model, base: node.base, transform: tr }); break;
      default: break; // empty, bundle/selected_item …
    }
  }

  async renderItem(id) {
    const db = this.db;
    const it = db.items[id];
    const baseId = it && it.base ? it.base : id;
    const ctx = { potionColor: it && it.potion ? (db.potions[it.potion]?.color ?? db.meta.defaultPotionColor) : null };
    const def = this.a.itemDef(baseId);
    if (!def) return null;
    const layers = [];
    this.collect(def.model, layers);
    const quads = [];
    let flat = false;
    for (const L of layers) {
      const tints = await Promise.all((L.tints || []).map((t) => this.tintColor(t, ctx)));
      const local = L.transform || new Affine();
      if (L.kind === 'model') {
        const m = this.a.model(L.model);
        let q;
        if (m.generated) { q = generatedQuads(m, tints); flat = true; } else q = blockQuads(this.a, m, tints);
        this.place(q, local, m.display.gui, m.guiLight === 'front' || m.generated, quads);
      } else {
        const base = this.a.model(L.base || 'item/generated');
        let q = specialQuads(L.spec, db);
        if (!q) { // Ersatz: Partikeltextur flach zeigen
          const tex = base.textures.particle;
          if (!tex) continue;
          q = generatedQuads({ textures: { layer0: tex } }, []);
          this.place(q, new Affine(), null, true, quads);
          continue;
        }
        this.place(q, local, base.display.gui, base.guiLight === 'front', quads);
      }
    }
    if (!quads.length) return null;
    return this.draw(quads, flat);
  }

  /** Modell → Bildschirm: lokale Transformation, −0,5, Anzeige (gui), Spiegelung der y-Achse */
  place(quads, local, gui, front, out) {
    const full = local.then(Affine.translate(-0.5, -0.5, -0.5)).then(displayAffine(gui));
    const lights = front ? LIGHT_FRONT : LIGHT_SIDE;
    for (const q of quads) {
      const P = q.p.map((v) => full.apply(v));
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const e3 = [P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]];
      let n = [e1[1] * e3[2] - e1[2] * e3[1], e1[2] * e3[0] - e1[0] * e3[2], e1[0] * e3[1] - e1[1] * e3[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-9) continue;
      n = n.map((x) => x / len);
      if (n[2] <= 1e-4) continue; // Rückseite
      let shade = 1;
      if (q.shade) {
        const d0 = Math.max(0, lights[0][0] * n[0] + lights[0][1] * n[1] + lights[0][2] * n[2]);
        const d1 = Math.max(0, lights[1][0] * n[0] + lights[1][1] * n[1] + lights[1][2] * n[2]);
        shade = Math.min(1, (d0 + d1) * 0.6 + 0.4);
      }
      const depth = (P[0][2] + P[1][2] + P[2][2] + P[3][2]) / 4 + (q.order || 0) * 0.002;
      out.push({ ...q, P, shade, depth });
    }
  }

  async draw(quads, flat) {
    const c = makeCanvas(SIZE, SIZE);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    quads.sort((a, b) => a.depth - b.depth || (a.layer ?? 0) - (b.layer ?? 0));
    const px = SIZE / 16; // Bildschirmpixel je GUI-Pixel
    for (const q of quads) {
      const tint = q.tint == null ? 0xffffff : q.tint;
      const s = q.shade;
      const r = Math.round(((tint >> 16) & 255) * s), gg = Math.round(((tint >> 8) & 255) * s), b = Math.round((tint & 255) * s);
      const rgb = (r << 16) | (gg << 8) | b;
      const full = q.uvUnit === 0;
      const tex = await this.a.tinted(q.tex, rgb, { full });
      if (!tex) continue;
      // UV → Texturpixel
      const ku = full ? 1 : tex.width / (q.uvUnit || 16);
      const kv = full ? 1 : tex.height / (q.uvUnit || 16);
      const uv = q.uv.map(([u, v]) => [u * ku, v * kv]);
      // Bildschirm: Mitte = Slotmitte, y nach unten
      const S = q.P.map((p) => [SIZE / 2 + p[0] * 16 * px, SIZE / 2 - p[1] * 16 * px]);
      const [u0, v0] = uv[0], [u1, v1] = uv[1], [u3, v3] = uv[3];
      const du1 = u1 - u0, dv1 = v1 - v0, du3 = u3 - u0, dv3 = v3 - v0;
      const det = du1 * dv3 - du3 * dv1;
      if (Math.abs(det) < 1e-9) continue;
      const dx1 = S[1][0] - S[0][0], dy1 = S[1][1] - S[0][1], dx3 = S[3][0] - S[0][0], dy3 = S[3][1] - S[0][1];
      const a = (dx1 * dv3 - dx3 * dv1) / det, cc = (dx3 * du1 - dx1 * du3) / det;
      const bb = (dy1 * dv3 - dy3 * dv1) / det, d = (dy3 * du1 - dy1 * du3) / det;
      const e = S[0][0] - a * u0 - cc * v0, f = S[0][1] - bb * u0 - d * v0;
      // Fläche leicht vergrößern, damit keine Nähte entstehen (bei flachen Items nicht nötig)
      const cx = (S[0][0] + S[1][0] + S[2][0] + S[3][0]) / 4, cy = (S[0][1] + S[1][1] + S[2][1] + S[3][1]) / 4;
      const grow = flat && q.layer != null ? 0 : 0.45;
      g.save();
      g.beginPath();
      S.forEach(([x, y], i) => {
        const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
        const X = x + (dx / l) * grow, Y = y + (dy / l) * grow;
        if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      });
      g.closePath();
      g.clip();
      g.setTransform(a, bb, cc, d, e, f);
      g.drawImage(tex, 0, 0);
      g.restore();
    }
    return c;
  }
}

// Für Tests im Browser
export const __test = { Assets, Renderer, unpack, specialQuads, transformationAffine, displayAffine, Affine, blockQuads };
