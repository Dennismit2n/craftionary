// Entwickler-Test: rendert ausgewählte Icons aus einem lokalen Jar als Übersicht
import { __test } from '../js/textures.js';
const { Assets, Renderer, unpack } = __test;
const params = new URLSearchParams(location.search);
const ids = (params.get('ids') || '').split(',').filter(Boolean);
const out = document.getElementById('out');
(async () => {
  const data = await fetch('/data/26.3.json').then((r) => r.json());
  const db = { data, items: data.items, potions: data.potions, meta: data.meta };
  const bytes = new Uint8Array(await fetch('/jar/client.jar').then((r) => r.arrayBuffer()));
  const t0 = performance.now();
  const files = await unpack(bytes);
  const assets = new Assets(files);
  const r = new Renderer(assets, db);
  const list = ids.length ? ids : Object.keys(data.items).slice(0, 60);
  for (const id of list) {
    const cell = document.createElement('figure');
    let c = null;
    try { c = await r.renderItem(id); } catch (e) { console.error(id, e); }
    if (c) {
      const img = document.createElement('canvas'); img.width = c.width; img.height = c.height;
      img.getContext('2d').drawImage(c, 0, 0);
      cell.append(img);
    } else { cell.append(Object.assign(document.createElement('div'), { className: 'miss', textContent: '–' })); }
    cell.append(Object.assign(document.createElement('figcaption'), { textContent: id }));
    out.append(cell);
  }
  document.title = 'done ' + Math.round(performance.now() - t0) + 'ms';
})();
