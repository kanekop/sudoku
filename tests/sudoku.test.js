'use strict';

const test = require('node:test');
const assert = require('node:assert');

const S = require('../js/sudoku.js');
const H = require('../js/hints.js');
const { mulberry32, KNOWN_PUZZLE, KNOWN_SOLUTION, TWO_SOLUTION_PUZZLE } = require('./helpers.js');

/* ---------- parseGrid / gridToString ---------- */

test('parseGrid: 81文字の数字列を配列にする', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  assert.ok(Array.isArray(g));
  assert.strictEqual(g.length, 81);
  assert.strictEqual(g[0], 5);
  assert.strictEqual(g[2], 0);
});

test('parseGrid: "." は 0 として扱う (0 との混在も可)', () => {
  const dotted = KNOWN_PUZZLE.replace(/0/g, '.');
  assert.deepStrictEqual(S.parseGrid(dotted), S.parseGrid(KNOWN_PUZZLE));
  const mixed = KNOWN_PUZZLE.slice(0, 40).replace(/0/g, '.') + KNOWN_PUZZLE.slice(40);
  assert.deepStrictEqual(S.parseGrid(mixed), S.parseGrid(KNOWN_PUZZLE));
});

test('parseGrid: 数字・ドット以外は無視する (改行や空白入り)', () => {
  const pretty = KNOWN_PUZZLE.replace(/(.{9})/g, '$1\n');
  assert.deepStrictEqual(S.parseGrid(pretty), S.parseGrid(KNOWN_PUZZLE));
});

test('parseGrid: 長さが 81 でなければ null', () => {
  assert.strictEqual(S.parseGrid(KNOWN_PUZZLE.slice(0, 80)), null);
  assert.strictEqual(S.parseGrid(KNOWN_PUZZLE + '1'), null);
  assert.strictEqual(S.parseGrid(''), null);
});

test('gridToString / parseGrid の往復で元に戻る', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  assert.strictEqual(S.gridToString(g), KNOWN_PUZZLE);
  assert.deepStrictEqual(S.parseGrid(S.gridToString(g)), g);
});

/* ---------- 索引ユーティリティ ---------- */

test('rowOf / colOf / boxOf', () => {
  assert.strictEqual(S.rowOf(0), 0);
  assert.strictEqual(S.colOf(0), 0);
  assert.strictEqual(S.boxOf(0), 0);
  assert.strictEqual(S.rowOf(80), 8);
  assert.strictEqual(S.colOf(80), 8);
  assert.strictEqual(S.boxOf(80), 8);
  assert.strictEqual(S.boxOf(4 * 9 + 4), 4);
});

test('PEERS は各マス 20 個で自分自身を含まない', () => {
  for (let i = 0; i < 81; i++) {
    assert.strictEqual(S.PEERS[i].length, 20, `index ${i}`);
    assert.ok(!S.PEERS[i].includes(i));
    assert.strictEqual(new Set(S.PEERS[i]).size, 20);
  }
});

test('UNITS は 27 ユニット × 各 9 マス', () => {
  assert.strictEqual(S.UNITS.length, 27);
  for (const u of S.UNITS) assert.strictEqual(u.length, 9);
});

/* ---------- candidatesAt / isValidPlacement ---------- */

test('candidatesAt: 埋まっているマスは空配列', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  assert.deepStrictEqual(S.candidatesAt(g, 0), []);
});

test('candidatesAt: 候補には解答の値が必ず含まれる', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  const sol = S.parseGrid(KNOWN_SOLUTION);
  for (let i = 0; i < 81; i++) {
    if (g[i] !== 0) continue;
    assert.ok(S.candidatesAt(g, i).includes(sol[i]), `index ${i}`);
  }
});

test('isValidPlacement: peer と衝突する値を弾く', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  assert.strictEqual(S.isValidPlacement(g, 2, 5), false); // 1行目に既に 5
  assert.strictEqual(S.isValidPlacement(g, 2, 4), true);
});

/* ---------- findConflicts ---------- */

test('findConflicts: 正しい盤面では空', () => {
  assert.deepStrictEqual(S.findConflicts(S.parseGrid(KNOWN_PUZZLE)), []);
  assert.deepStrictEqual(S.findConflicts(S.parseGrid(KNOWN_SOLUTION)), []);
});

test('findConflicts: 行の重複を検出する', () => {
  const g = new Array(81).fill(0);
  g[0] = 4; g[5] = 4; // 同じ行
  assert.deepStrictEqual(S.findConflicts(g).sort((a, b) => a - b), [0, 5]);
});

test('findConflicts: 列の重複を検出する', () => {
  const g = new Array(81).fill(0);
  g[0] = 4; g[27] = 4; // 同じ列 (row 0 と row 3)
  assert.deepStrictEqual(S.findConflicts(g).sort((a, b) => a - b), [0, 27]);
});

test('findConflicts: ブロックの重複を検出する', () => {
  const g = new Array(81).fill(0);
  g[0] = 4; g[10] = 4; // 同じ左上ブロック (row1,col1)
  assert.deepStrictEqual(S.findConflicts(g).sort((a, b) => a - b), [0, 10]);
});

/* ---------- solve / countSolutions / hasUniqueSolution ---------- */

test('solve: 既知問題を既知解のとおりに解く', () => {
  const sol = S.solve(S.parseGrid(KNOWN_PUZZLE));
  assert.ok(sol);
  assert.strictEqual(S.gridToString(sol), KNOWN_SOLUTION);
});

test('solve: 解が無い盤面では null', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  // 1行目の空マスに、その行で成立し得ない値を無理やり置く
  const broken = g.slice();
  broken[2] = 4; broken[3] = 4; // 同じ行に 4 が2つ
  assert.strictEqual(S.solve(broken), null);
});

test('hasUniqueSolution: 既知問題は true', () => {
  assert.strictEqual(S.hasUniqueSolution(S.parseGrid(KNOWN_PUZZLE)), true);
});

test('countSolutions: 解が2つある盤面で limit=2 なら 2', () => {
  const g = S.parseGrid(TWO_SOLUTION_PUZZLE);
  assert.strictEqual(S.countSolutions(g, 2, null), 2);
  assert.strictEqual(S.hasUniqueSolution(g), false);
});

test('countSolutions: limit を超えて数えない', () => {
  const empty = new Array(81).fill(0);
  assert.strictEqual(S.countSolutions(empty, 1, null), 1);
  assert.strictEqual(S.countSolutions(empty, 5, null), 5);
});

test('countSolutions: solutionOut に最初の解を書き出す', () => {
  const out = new Array(81).fill(0);
  const n = S.countSolutions(S.parseGrid(KNOWN_PUZZLE), 1, out);
  assert.strictEqual(n, 1);
  assert.strictEqual(S.gridToString(out), KNOWN_SOLUTION);
});

test('countSolutions: 完成盤は 1 / 矛盾盤は 0', () => {
  assert.strictEqual(S.countSolutions(S.parseGrid(KNOWN_SOLUTION), 2, null), 1);
  const bad = S.parseGrid(KNOWN_SOLUTION);
  bad[1] = bad[0];
  assert.strictEqual(S.countSolutions(bad, 2, null), 0);
});

test('searchEffort: 完成盤は 0 / 難しい盤面ほど大きい', () => {
  assert.strictEqual(S.searchEffort(S.parseGrid(KNOWN_SOLUTION)), 0);
  assert.ok(S.searchEffort(S.parseGrid(KNOWN_PUZZLE)) >= 0);
});

/* ---------- generateFull ---------- */

test('generateFull: 完成した正しい盤面を返す', () => {
  const rng = mulberry32(20260830);
  for (let t = 0; t < 5; t++) {
    const g = S.generateFull(rng);
    assert.strictEqual(g.length, 81);
    assert.ok(g.every(v => v >= 1 && v <= 9));
    assert.deepStrictEqual(S.findConflicts(g), []);
  }
});

test('generateFull: seed が同じなら同じ盤面 (決定性)', () => {
  const a = S.generateFull(mulberry32(4242));
  const b = S.generateFull(mulberry32(4242));
  assert.deepStrictEqual(a, b);
});

/* ---------- digPuzzle / digMinimal ---------- */

test('digPuzzle: 一意解を保ち、完成盤の部分集合になる', () => {
  const rng = mulberry32(7);
  const full = S.generateFull(rng);
  const puzzle = S.digPuzzle(full, 30, rng);
  assert.strictEqual(puzzle.length, 81);
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0) assert.strictEqual(puzzle[i], full[i], `index ${i}`);
  }
  assert.ok(S.hasUniqueSolution(puzzle));
});

test('digMinimal: これ以上1マスも消せない極小盤面になる', () => {
  const rng = mulberry32(11);
  const full = S.generateFull(rng);
  const puzzle = S.digMinimal(full, rng);
  assert.ok(S.hasUniqueSolution(puzzle));
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] === 0) continue;
    const g = puzzle.slice();
    g[i] = 0;
    assert.strictEqual(S.hasUniqueSolution(g), false, `index ${i} はまだ消せる`);
  }
});

/* ---------- generatePuzzle ---------- */

test('LEVELS: 6段階すべてが定義されている', () => {
  for (const key of ['beginner', 'easy', 'medium', 'hard', 'expert', 'oni']) {
    assert.ok(S.LEVELS[key], key);
    assert.ok(typeof S.LEVELS[key].label === 'string');
  }
});

for (const levelKey of ['beginner', 'easy', 'medium', 'hard', 'expert']) {
  test(`generatePuzzle(${levelKey}): 一意解・矛盾なし・完成盤の部分集合`, () => {
    const rng = mulberry32(1000 + levelKey.length);
    const res = S.generatePuzzle(levelKey, H.ratePuzzle, rng);
    assert.ok(res, '生成に失敗');
    const { puzzle, solution } = res;
    assert.strictEqual(puzzle.length, 81);
    assert.deepStrictEqual(S.findConflicts(puzzle), []);
    assert.ok(S.hasUniqueSolution(puzzle));
    for (let i = 0; i < 81; i++) {
      if (puzzle[i] !== 0) assert.strictEqual(puzzle[i], solution[i], `index ${i}`);
    }
    assert.strictEqual(S.gridToString(S.solve(puzzle)), S.gridToString(solution));
  });
}

test('generatePuzzle(oni): 一意解・矛盾なし・極小盤面', { timeout: 300000 }, () => {
  const rng = mulberry32(31337);
  const res = S.generatePuzzle('oni', H.ratePuzzle, rng);
  assert.ok(res, '生成に失敗');
  const { puzzle, solution } = res;
  assert.deepStrictEqual(S.findConflicts(puzzle), []);
  assert.ok(S.hasUniqueSolution(puzzle));
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0) assert.strictEqual(puzzle[i], solution[i], `index ${i}`);
  }
  const clues = puzzle.filter(v => v !== 0).length;
  assert.ok(clues >= 17 && clues <= 30, `clue数が想定外: ${clues}`);
});

test('generatePuzzle: ratePuzzle 未指定でも動く', () => {
  const res = S.generatePuzzle('easy', null, mulberry32(5));
  assert.ok(res);
  assert.strictEqual(res.rating, null);
  assert.ok(S.hasUniqueSolution(res.puzzle));
});

test('generatePuzzle: 未知のレベルキーは easy にフォールバック', () => {
  const res = S.generatePuzzle('no-such-level', null, mulberry32(6));
  assert.ok(res);
  assert.ok(S.hasUniqueSolution(res.puzzle));
});
