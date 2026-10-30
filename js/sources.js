// Craftionary – Fundorte: Erz-Verteilung über die Höhe und Hilfen zur Anzeige der Quellen aus data/sources-<version>.json

export const DIM = { overworld: [-64, 319], nether: [0, 255], end: [0, 255] };
export const SEA_LEVEL = 63;

// Anteil der Ader-Mittelpunkte auf Höhe y – wie TrapezoidHeight bzw. UniformHeight im Spiel (Summe zweier Ganzzahl-Würfe)
export function heightShare(y, f) {
  if (y < f.lo || y > f.hi) return 0;
  if (f.shape === 'u') return 1 / (f.hi - f.lo + 1);
  const r = f.hi - f.lo, j = Math.floor((r - (f.pl || 0)) / 2), k = r - j, t = y - f.lo;
  return Math.max(0, Math.min(k, t) - Math.max(0, t - j) + 1) / ((k + 1) * (j + 1));
}

// Grundgestein am Boden: unten immer, darüber in Fünftel-Schritten weniger (material_rule/bedrock_floor)
export function bedrock(y, dim) {
  const floor = DIM[dim][0];
  if (y <= floor) return 1;
  if (y >= floor + 5) return 0;
  return (floor + 5 - y) / 5;
}

/**
 * Erz-Profil je Dimension: erwartete Erzblöcke pro Chunk und Schicht (Adergröße als Blockzahl genähert).
 * Liefert [{ dim, lo, hi, vals, best, band, low, visible }] – low = beste Höhe bis Meereshöhe, falls die beste ganz oben liegt.
 */
export function oreProfiles(src, featureKeys) {
  const byDim = {};
  for (const key of new Set(featureKeys)) { const f = src.ores[key]; if (f) (byDim[f.dim] ??= []).push(f); }
  return Object.entries(byDim).map(([dim, fs]) => {
    const [lo, hi] = DIM[dim];
    const vals = [], vis = [];
    for (let y = lo; y <= hi; y++) {
      const keep = 1 - bedrock(y, dim);
      vals.push(fs.reduce((s, f) => s + f.n * f.size * heightShare(y, f), 0) * keep);
      vis.push(fs.reduce((s, f) => s + f.n * f.size * (1 - f.air) * heightShare(y, f), 0) * keep);
    }
    const peak = (from, to) => {
      let b = from;
      for (let y = from; y <= to; y++) if (vals[y - lo] > vals[b - lo]) b = y;
      const top = vals[b - lo];
      let a = null, z = null;
      for (let y = from; y <= to; y++) if (vals[y - lo] >= 0.8 * top) { a ??= y; z = y; }
      return { y: b, band: [a, z], v: top };
    };
    const best = peak(lo, hi);
    const low = dim === 'overworld' && best.y > 100 ? peak(lo, SEA_LEVEL) : null;
    const visible = best.v > 0 ? vis[best.y - lo] / best.v : 1;
    return { dim, lo, hi, vals, best, low: low && low.v > 0 ? low : null, visible, biomes: mergeBiomes(fs) };
  }).filter((p) => p.best.v > 0);
}

function mergeBiomes(fs) {
  if (fs.some((f) => f.b === 'all')) return 'all';
  return [...new Set(fs.flatMap((f) => f.b))].sort();
}

/** Blöcke, aus denen das Item kommt (Drops) plus das Item selbst, falls es ein Erz ist */
export function sourceBlocks(src, id) {
  const rows = src.items[id] || [];
  return [...new Set([...rows.filter((r) => r[0] === 'block').map((r) => r[1]), id])];
}

export function featuresFor(src, id) {
  return sourceBlocks(src, id).flatMap((b) => src.oreBlocks[b] || []);
}

/** Große Erzadern, die das Item liefern (Erzblock, Rohblock oder deren Drops) */
export function veinsFor(src, id) {
  const blocks = sourceBlocks(src, id);
  return Object.entries(src.veins).filter(([, v]) => blocks.includes(v.ore) || blocks.includes(v.raw)).map(([kind, v]) => ({ kind, ...v }));
}

/** Prozent mit sinnvoller Genauigkeit: 100 %, 66,7 %, 5,9 %, 0,83 % */
export function fmtPct(p, lang = 'de') {
  const v = p * 100;
  const digits = v >= 99.95 ? 0 : v >= 10 ? 1 : v >= 1 ? 1 : 2;
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: v >= 99.95 ? 0 : digits }).format(v) + (lang === 'de' ? ' %' : '%');
}

/** Höhe mit echtem Minuszeichen: Y −59 statt Y -59 */
export const fmtY = (y) => (y < 0 ? `−${-y}` : String(y));

export const fmtCount =(min, max) => (min === max ? `×${min}` : `${min}–${max}`);
