// Craftionary – eigene, schlichte 16×16-Pixel-Symbole für die Stationen.
// Werden genutzt, solange keine Original-Texturen geladen sind. Bewusst eigene Motive.

const PAL = {
  '.': null,
  k: '#1b1b1f', // Kontur
  w: '#6b4a2b', // Holz dunkel
  W: '#9a7146', // Holz hell
  s: '#5d6066', // Stein dunkel
  S: '#8d9097', // Stein hell
  o: '#f39c32', // Flamme orange
  y: '#ffd54a', // Flamme gelb
  r: '#c8452b', // Glut
  g: '#c7cbd1', // Metall hell
  G: '#9aa0a8', // Metall
  b: '#3b6fd8', // Trank blau
  B: '#86b4ff', // Trank hell
  c: '#e9eef5', // Glas
  l: '#3f8f3a', // Grün
  m: '#4b2f1b', // sehr dunkles Holz
};

const G = {
  crafting: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kWWWWkWWWWkWWk.',
    '.kWwwWkWwwWkWwk.',
    '.kWWWWkWWWWkWWk.',
    '.kkkkkkkkkkkkkk.',
    '.kWWWWkWWWWkWWk.',
    '.kWwwWkWwwWkWwk.',
    '.kWWWWkWWWWkWWk.',
    '.kkkkkkkkkkkkkk.',
    '.kWWWWkWWWWkWWk.',
    '.kWwwWkWwwWkWwk.',
    '.kWWWWkWWWWkWWk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  inventory: [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kSSSSkSSSSSk..',
    '..kSssSkSssSSk..',
    '..kSssSkSssSSk..',
    '..kSSSSkSSSSSk..',
    '..kkkkkkkkkkkk..',
    '..kSSSSkSSSSSk..',
    '..kSssSkSssSSk..',
    '..kSssSkSssSSk..',
    '..kSSSSkSSSSSk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ],
  furnace: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kSSSSSSSSSSSSk.',
    '.kSssSSSSSSssSk.',
    '.kSSSSSSSSSSSSk.',
    '.kSSkkkkkkkkSSk.',
    '.kSSkmmmmmmkSSk.',
    '.kSSkmmyymmkSSk.',
    '.kSSkmoyyomkSSk.',
    '.kSSkoryyrokSSk.',
    '.kSSkkkkkkkkSSk.',
    '.kSSSSSSSSSSSSk.',
    '.kSssSSSSSSssSk.',
    '.kSSSSSSSSSSSSk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  blast_furnace: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kGGGGGGGGGGGGk.',
    '.kGssssssssssGk.',
    '.kGsGsGsGsGssGk.',
    '.kGssssssssssGk.',
    '.kGGkkkkkkkkGGk.',
    '.kssksksksksssk.',
    '.kssksksksksssk.',
    '.kssyoyoyoyossk.',
    '.kssrorororossk.',
    '.kGGkkkkkkkkGGk.',
    '.kGssssssssssGk.',
    '.kGGGGGGGGGGGGk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  smoker: [
    '......SS..S.....',
    '....S..SS...S...',
    '.kkkkkkkkkkkkkk.',
    '.kmmmmmmmmmmmmk.',
    '.kwWWwWWwWWwWwk.',
    '.kWwwWwwWwwWwwk.',
    '.kSSkkkkkkkkSSk.',
    '.kSSkmmmmmmkSSk.',
    '.kSSkmoyyomkSSk.',
    '.kSSkoryyrokSSk.',
    '.kSSkkkkkkkkSSk.',
    '.kwWWwWWwWWwWwk.',
    '.kWwwWwwWwwWwwk.',
    '.kmmmmmmmmmmmmk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  campfire: [
    '.......y........',
    '......yy..y.....',
    '.....yoy.yy.....',
    '....yooyyoy.....',
    '....yoooooy.....',
    '...yoorrrooy....',
    '...yorrrrroy....',
    '....orrrrro.....',
    '..kkkkkkkkkkkk..',
    '..kwWWwWWwWWwk..',
    '..kkkkkkkkkkkk..',
    'kkkkk......kkkkk',
    'kWwWk......kWwWk',
    'kWwWk......kWwWk',
    'kkkkk......kkkkk',
    '................',
  ],
  stonecutter: [
    '................',
    '.......kk.......',
    '......kggk......',
    '.....kgGGgk.....',
    '....kgGkkGgk....',
    '....kgGkkGgk....',
    '.....kgGGgk.....',
    '..kkkkkggkkkkk..',
    '..kWWWWWWWWWWk..',
    '..kwwwwwwwwwwk..',
    '.kkkkkkkkkkkkkk.',
    '.kSSSSSSSSSSSSk.',
    '.kSssSSSSSSssSk.',
    '.kSSSSSSSSSSSSk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  smithing: [
    '................',
    '.....kkkkk......',
    '....kgggGGk.....',
    '....kgGGGGk.....',
    '.....kkWkk......',
    '.......Wk.......',
    '.......Wk.......',
    '..kkkkkkkkkkkk..',
    '.kssssssssssssk.',
    '.kSSSSSSSSSSSSk.',
    '.kkkkkkkkkkkkkk.',
    '...kmk....kmk...',
    '...kmk....kmk...',
    '...kmk....kmk...',
    '..kkkkk..kkkkk..',
    '................',
  ],
  brewing: [
    '.......kk.......',
    '......kcck......',
    '......kcck......',
    '.....kccBck.....',
    '....kcBbbBck....',
    '...kcBbbbbBck...',
    '...kcbbbbbbck...',
    '...kcbbbbbbck...',
    '....kcbbbbck....',
    '.....kkkkkk.....',
    '.......kk.......',
    '....kkkkkkkk....',
    '...kssSSSSssk...',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
};

const cache = new Map();

/** Liefert eine data:-URL (PNG) für das Stationssymbol */
export function glyphUrl(name, scale = 4) {
  const key = name + '@' + scale;
  if (cache.has(key)) return cache.get(key);
  const rows = G[name];
  if (!rows) return null;
  const c = document.createElement('canvas');
  c.width = 16 * scale;
  c.height = 16 * scale;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = PAL[ch];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export const GLYPH_NAMES = Object.keys(G);
