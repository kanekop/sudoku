'use strict';

/* ocr.js の幾何まわり (純関数) だけを対象にしたテスト。
 * 画像処理 (warpImage / recognizeGrid) は canvas / Tesseract に依存するため対象外。 */

const test = require('node:test');
const assert = require('node:assert');

const OCR = require('../js/ocr.js');

const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

/* ---------- squareToQuad ---------- */

test('squareToQuad: 正方形なら単位正方形の4隅をそのまま写す', () => {
  const map = OCR.squareToQuad(SQUARE);
  assert.deepStrictEqual(map(0, 0), { x: 0, y: 0 });
  assert.deepStrictEqual(map(1, 0), { x: 100, y: 0 });
  assert.deepStrictEqual(map(1, 1), { x: 100, y: 100 });
  assert.deepStrictEqual(map(0, 1), { x: 0, y: 100 });
  assert.deepStrictEqual(map(0.5, 0.5), { x: 50, y: 50 });
});

test('squareToQuad: 台形でも4隅が一致し、内部は有限値', () => {
  const quad = [{ x: 20, y: 10 }, { x: 90, y: 25 }, { x: 80, y: 95 }, { x: 5, y: 80 }];
  const map = OCR.squareToQuad(quad);
  const corners = [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
  corners.forEach((c, k) => {
    assert.ok(Math.abs(c.x - quad[k].x) < 1e-6, `x[${k}]`);
    assert.ok(Math.abs(c.y - quad[k].y) < 1e-6, `y[${k}]`);
  });
  for (let t = 0; t <= 1; t += 0.25) {
    const p = map(t, t);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

test('squareToQuad: 3点が一直線の退化四角形でも NaN/Infinity を返さない', () => {
  // tr(100,0), br(50,50), bl(0,100) が一直線 = den が 0 になる
  const degenerate = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 100 }];
  const map = OCR.squareToQuad(degenerate);
  for (let u = 0; u <= 1; u += 0.2) {
    for (let v = 0; v <= 1; v += 0.2) {
      const p = map(u, v);
      assert.ok(Number.isFinite(p.x), `x が有限でない (u=${u}, v=${v})`);
      assert.ok(Number.isFinite(p.y), `y が有限でない (u=${u}, v=${v})`);
    }
  }
});

test('squareToQuad: 単位正方形の内側に無限遠点があっても NaN/Infinity を返さない', () => {
  // tr, br, bl が一直線でないが w = 0 が単位正方形内に落ちる形
  const map = OCR.squareToQuad(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 100 }]);
  for (let u = 0; u <= 1; u += 0.2) {
    for (let v = 0; v <= 1; v += 0.2) {
      const p = map(u, v);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `(u=${u}, v=${v})`);
    }
  }
});

test('squareToQuad: 2点が完全に重なっても NaN/Infinity を返さない', () => {
  const collapsed = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
  const map = OCR.squareToQuad(collapsed);
  for (let u = 0; u <= 1; u += 0.25) {
    for (let v = 0; v <= 1; v += 0.25) {
      const p = map(u, v);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `(u=${u}, v=${v})`);
    }
  }
});

/* ---------- isConvexQuad ---------- */

test('isConvexQuad: まっとうな四角形は通す', () => {
  assert.strictEqual(OCR.isConvexQuad(SQUARE, 10), true);
  // 写真らしく傾いた四角形
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: 12, y: 8 }, { x: 95, y: 20 }, { x: 88, y: 97 }, { x: 4, y: 84 }], 10), true);
});

test('isConvexQuad: 3点が一直線なら弾く', () => {
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], 10), false);
});

test('isConvexQuad: 2点が重なる/辺が短すぎるなら弾く', () => {
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], 10), false);
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 100 }, { x: 0, y: 100 }], 10), false);
});

test('isConvexQuad: 凹み・ねじれ(自己交差)を弾く', () => {
  // br を中に引き込んで凹ませる
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 100 }], 10), false);
  // tr と br を入れ替えて蝶ネクタイ型にする
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }], 10), false);
});

test('isConvexQuad: 不正な入力を弾く', () => {
  assert.strictEqual(OCR.isConvexQuad(null, 10), false);
  assert.strictEqual(OCR.isConvexQuad(SQUARE.slice(0, 3), 10), false);
  assert.strictEqual(OCR.isConvexQuad(
    [{ x: NaN, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], 10), false);
});

test('isConvexQuad が通した四隅なら squareToQuad は必ず有限値を返す', () => {
  const quads = [
    SQUARE,
    [{ x: 12, y: 8 }, { x: 95, y: 20 }, { x: 88, y: 97 }, { x: 4, y: 84 }],
    [{ x: 30, y: 5 }, { x: 120, y: 30 }, { x: 100, y: 140 }, { x: 10, y: 110 }],
  ];
  for (const q of quads) {
    assert.strictEqual(OCR.isConvexQuad(q, 8), true);
    const map = OCR.squareToQuad(q);
    for (let u = 0; u <= 1; u += 0.1) {
      for (let v = 0; v <= 1; v += 0.1) {
        const p = map(u, v);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      }
    }
  }
});
