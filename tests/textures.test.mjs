// Craftionary – Texturen: Auflösung der Textur-Verweise in Blockmodellen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../js/textures.js';

const { Assets, blockQuads } = __test;
const assets = new Assets(new Map());

test('resolveTex: "#all" und verkettete Verweise', () => {
  assert.equal(assets.resolveTex({ all: 'block/stone' }, '#all'), 'block/stone');
  assert.equal(assets.resolveTex({ a: '#b', b: 'block/dirt' }, '#a'), 'block/dirt');
  assert.equal(assets.resolveTex({ a: { sprite: 'block/dirt' } }, '#a'), 'block/dirt');
});

test('resolveTex: Name aus der Textur-Tabelle gilt auch ohne #', () => {
  assert.equal(assets.resolveTex({ all: 'block/heavy_core' }, 'all'), 'block/heavy_core');
});

test('resolveTex: direkter Pfad bleibt, fehlender Verweis ergibt null', () => {
  assert.equal(assets.resolveTex({ all: 'block/stone' }, 'block/stone'), 'block/stone');
  assert.equal(assets.resolveTex(undefined, 'block/stone'), 'block/stone');
  assert.equal(assets.resolveTex({}, '#fehlt'), null);
});

test('Schwerer Kern: Mojangs Modell mit "all" statt "#all" liefert alle 6 Flächen', () => {
  const model = {
    textures: { all: 'block/heavy_core', particle: 'block/heavy_core' },
    elements: [{
      from: [4, 0, 4], to: [12, 8, 12],
      faces: {
        north: { uv: [0, 8, 8, 16], texture: 'all' },
        east: { uv: [0, 8, 8, 16], texture: 'all' },
        south: { uv: [0, 8, 8, 16], texture: 'all' },
        west: { uv: [0, 8, 8, 16], texture: 'all' },
        up: { uv: [0, 0, 8, 8], texture: 'all' },
        down: { uv: [8, 0, 16, 8], texture: 'all' },
      },
    }],
  };
  const quads = blockQuads(assets, model, []);
  assert.equal(quads.length, 6);
  assert.ok(quads.every((q) => q.tex === 'block/heavy_core'));
});
