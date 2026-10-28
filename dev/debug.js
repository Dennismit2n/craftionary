import { __test } from '../js/textures.js';
const { Assets, Renderer, unpack, specialQuads, transformationAffine } = __test;
(async () => {
  const data = await fetch('/data/26.3.json').then((r) => r.json());
  const db = { data, items: data.items, potions: data.potions, meta: data.meta };
  const files = await unpack(new Uint8Array(await fetch('/jar/client.jar').then((r) => r.arrayBuffer())));
  const a = new Assets(files);
  const r = new Renderer(a, db);
  const out = document.getElementById('out');
  const show = async (label, quads) => {
    const placed = [];
    r.place(quads, transformationAffine({ scale: [1, -1, -1] }), { rotation: [15, -25, -5], translation: [2, 3, 0], scale: [0.65, 0.65, 0.65] }, true, placed);
    const c = await r.draw(placed, false);
    const fig = document.createElement('figure');
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; cv.getContext('2d').drawImage(c, 0, 0);
    fig.append(cv, Object.assign(document.createElement('figcaption'), { textContent: label + ' ' + placed.map((p) => p.depth.toFixed(2)).join(',') }));
    out.append(fig);
  };
  const q = specialQuads({ type: 'minecraft:shield' }, db);
  await show('plate', q.slice(0, 6));
  await show('handle', q.slice(6));
  await show('plate-north', [q[3]]);
  await show('all', q);
  document.title = 'done';
})();
