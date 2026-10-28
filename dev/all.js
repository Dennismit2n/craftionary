import { __test } from '../js/textures.js';
const { Assets, Renderer, unpack } = __test;
(async () => {
  const data = await fetch('/data/26.3.json').then((r) => r.json());
  const db = { data, items: data.items, potions: data.potions, meta: data.meta };
  const t0 = performance.now();
  const files = await unpack(new Uint8Array(await fetch('/jar/client.jar').then((r) => r.arrayBuffer())));
  const t1 = performance.now();
  const r = new Renderer(new Assets(files), db);
  const ids = Object.keys(data.items).filter((id) => id !== 'air' && !data.items[id].group);
  const miss = [], fail = [];
  const out = document.getElementById('out');
  let blobBytes = 0;
  for (const id of ids) {
    try {
      const c = await r.renderItem(id);
      if (!c) { miss.push(id); continue; }
      const b = await (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((res) => c.toBlob(res)));
      blobBytes += b.size;
      const img = new Image(); img.src = URL.createObjectURL(b); img.title = id; img.width = 48; img.height = 48;
      out.append(img);
    } catch (e) { fail.push(id + ': ' + e.message); }
  }
  const t2 = performance.now();
  document.getElementById('rep').textContent = JSON.stringify({ n: ids.length, unpackMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1), kb: Math.round(blobBytes / 1024), miss, fail }, null, 1);
  document.title = 'done';
})();
