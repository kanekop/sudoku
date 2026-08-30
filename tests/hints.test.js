'use strict';

const test = require('node:test');
const assert = require('node:assert');

const S = require('../js/sudoku.js');
const H = require('../js/hints.js');
const { mulberry32, KNOWN_PUZZLE, KNOWN_SOLUTION } = require('./helpers.js');

/* findMoves の先頭手が想定の手筋・値になる固定盤面。
 * 配置系 (Naked/Hidden Single) と、除去カスケードの起点になる手筋を確認する。 */
const FIXTURES = {
  nakedSingle: {
    grid: '602005400570004900890700000205409030030258040040103207000007014001300095009800306',
    technique: 'nakedSingle', row: 0, col: 1, val: 1,
  },
  hiddenSingle: {
    grid: '496200700500063020000000000003807006605000408700604300000000000060480005002006147',
    technique: 'hiddenSingle', row: 1, col: 8, val: 4,
  },
  lockedCandidates: {
    grid: '496200700500063024000040000043807006605000478789604300004070000067480005802006147',
    technique: 'nakedSingle', row: 0, col: 4, val: 1,
    chainHead: '予約 (Locked Candidates)',
  },
  nakedPair: {
    grid: '500100300107023900036008000765819243328040619491030758600300800803060002074081536',
    technique: 'nakedSingle', row: 2, col: 7, val: 2,
    chainHead: '裸のペア (Naked Pair)',
  },
  trial: {
    grid: '009007002760801439000009057207010003030205040000030200620493000403002090000100324',
    technique: 'trial', row: 1, col: 2, val: 5,
  },
};

for (const [name, f] of Object.entries(FIXTURES)) {
  test(`findMoves: ${name} が先頭手になる固定盤面`, () => {
    const g = S.parseGrid(f.grid);
    assert.ok(g, 'fixture のパースに失敗');
    const moves = H.findMoves(g);
    assert.ok(moves.length > 0, '手が1つも返らない');
    const mv = moves[0];
    assert.strictEqual(mv.technique, f.technique);
    assert.strictEqual(mv.row, f.row);
    assert.strictEqual(mv.col, f.col);
    assert.strictEqual(mv.val, f.val);
    if (f.chainHead) {
      assert.match(mv.reason, new RegExp('【手順1: ' + f.chainHead.replace(/[()]/g, '\\$&')));
    }
  });
}

/* 除去系の手筋は findMoves のカスケードでは前段が先に発火して到達しないことがあるため、
 * 公開された apply* を固定盤面に直接あてて検証する。 */

test('applyLockedCandidates: ブロック内の並びから候補を除去する', () => {
  const g = S.parseGrid(FIXTURES.lockedCandidates.grid);
  const map = H.buildCandMap(g);
  const res = H.applyLockedCandidates(g, map);
  assert.ok(res, '発火しなかった');
  assert.strictEqual(res.technique, 'lockedCandidates');
  assert.ok(res.eliminations.length > 0);
  // 除去された候補は candMap から実際に消えている
  for (const e of res.eliminations) assert.strictEqual(map[e.index].has(e.val), false);
});

test('applyNakedSets(2): 裸のペアで候補を除去する', () => {
  const g = S.parseGrid(FIXTURES.nakedPair.grid);
  const map = H.buildCandMap(g);
  const res = H.applyNakedSets(g, map, 2);
  assert.ok(res, '発火しなかった');
  assert.strictEqual(res.technique, 'nakedSet2');
  assert.strictEqual(res.highlights.length, 2);
  assert.ok(res.eliminations.length > 0);
});

test('applyNakedSets(3): 裸のトリプルで候補を除去する', () => {
  const g = S.parseGrid('023000700604307000700100403300806950000003600056904302007031009030698107009000830');
  const map = H.buildCandMap(g);
  const res = H.applyNakedSets(g, map, 3);
  assert.ok(res, '発火しなかった');
  assert.strictEqual(res.technique, 'nakedSet3');
  assert.strictEqual(res.highlights.length, 3);
  assert.ok(res.eliminations.length > 0);
});

test('applyHiddenPairs: 隠れたペアで余分な候補を除去する', () => {
  // 隠れたペアだけが発火し、他の除去手筋は空振りする盤面
  const g = S.parseGrid('000000000904607000076804100309701080008000300050308702007502610000403208000000000');
  const map = H.buildCandMap(g);
  assert.strictEqual(H.applyLockedCandidates(g, H.buildCandMap(g)), null);
  assert.strictEqual(H.applyNakedSets(g, H.buildCandMap(g), 2), null);
  const res = H.applyHiddenPairs(g, map);
  assert.ok(res, '発火しなかった');
  assert.strictEqual(res.technique, 'hiddenPair');
  assert.strictEqual(res.highlights.length, 2);
  assert.ok(res.eliminations.length > 0);
  for (const e of res.eliminations) assert.strictEqual(map[e.index].has(e.val), false);
});

test('applyXWing: 長方形パターンで候補を除去する', () => {
  const g = S.parseGrid('100000569492056108056109240009640801064010000218035604040500016905061402621000005');
  const map = H.buildCandMap(g);
  const res = H.applyXWing(g, map);
  assert.ok(res, '発火しなかった');
  assert.strictEqual(res.technique, 'xwing');
  assert.strictEqual(res.highlights.length, 4);
  assert.ok(res.eliminations.length > 0);
  // 除去した候補は解答の値であってはならない
  const sol = S.solve(g);
  for (const e of res.eliminations) assert.notStrictEqual(sol[e.index], e.val);
});

/* ---------- Move オブジェクトの体裁 ---------- */

test('findMoves: 返す手は必ず必要なフィールドを備える', () => {
  const moves = H.findMoves(S.parseGrid(KNOWN_PUZZLE));
  assert.ok(moves.length > 0);
  for (const mv of moves) {
    assert.ok(Number.isInteger(mv.row) && mv.row >= 0 && mv.row < 9);
    assert.ok(Number.isInteger(mv.col) && mv.col >= 0 && mv.col < 9);
    assert.ok(Number.isInteger(mv.val) && mv.val >= 1 && mv.val <= 9);
    assert.ok(typeof mv.technique === 'string' && mv.technique);
    assert.ok(typeof mv.techniqueLabel === 'string' && mv.techniqueLabel);
    assert.ok(typeof mv.reason === 'string' && mv.reason);
    assert.ok(typeof mv.difficulty === 'number');
    assert.ok(Array.isArray(mv.highlights));
    assert.ok(Array.isArray(mv.eliminations));
  }
});

test('findMoves: 同じマス・同じ値の手を重複して返さない', () => {
  const moves = H.findMoves(S.parseGrid(KNOWN_PUZZLE));
  const keys = moves.map(m => `${m.row},${m.col},${m.val}`);
  assert.strictEqual(new Set(keys).size, keys.length);
});

test('findMoves: 難易度の易しい順に並ぶ', () => {
  const moves = H.findMoves(S.parseGrid(KNOWN_PUZZLE));
  for (let i = 1; i < moves.length; i++) {
    assert.ok(moves[i - 1].difficulty <= moves[i].difficulty);
  }
});

test('findMoves: 完成盤では手を返さない', () => {
  assert.deepStrictEqual(H.findMoves(S.parseGrid(KNOWN_SOLUTION)), []);
});

/* ---------- 正しさのファジング (手筋バグの最強の検出器) ---------- */

test('findMoves: 提示する手はすべて正解と一致する (既知問題を完走)', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  const sol = S.parseGrid(KNOWN_SOLUTION);
  for (let step = 0; step < 200 && g.some(v => v === 0); step++) {
    const moves = H.findMoves(g);
    assert.ok(moves.length > 0, `step ${step} で手が尽きた`);
    for (const mv of moves) {
      assert.strictEqual(mv.val, sol[mv.row * 9 + mv.col],
        `step ${step}: (${mv.row + 1},${mv.col + 1}) の ${mv.val} が誤り [${mv.technique}]`);
    }
    g[moves[0].row * 9 + moves[0].col] = moves[0].val;
  }
  assert.strictEqual(S.gridToString(g), KNOWN_SOLUTION);
});

test('findMoves: 生成問題でも提示する手がすべて正解と一致する', { timeout: 300000 }, () => {
  const rng = mulberry32(99);
  const levels = ['beginner', 'easy', 'medium', 'hard', 'expert'];
  for (let n = 0; n < 15; n++) {
    const levelKey = levels[n % levels.length];
    const res = S.generatePuzzle(levelKey, H.ratePuzzle, rng);
    assert.ok(res, `${levelKey} の生成に失敗`);
    const sol = res.solution;
    const g = res.puzzle.slice();
    for (let step = 0; step < 200 && g.some(v => v === 0); step++) {
      const moves = H.findMoves(g);
      assert.ok(moves.length > 0, `${levelKey}#${n} step ${step} で手が尽きた`);
      for (const mv of moves) {
        assert.strictEqual(mv.val, sol[mv.row * 9 + mv.col],
          `${levelKey}#${n} step ${step}: (${mv.row + 1},${mv.col + 1}) の ${mv.val} が誤り [${mv.technique}]`);
      }
      g[moves[0].row * 9 + moves[0].col] = moves[0].val;
    }
    assert.deepStrictEqual(g, sol, `${levelKey}#${n} を解ききれなかった`);
  }
});

test('findMoves: eliminations で消した候補は解答の値でない', () => {
  const rng = mulberry32(2468);
  for (let n = 0; n < 5; n++) {
    const res = S.generatePuzzle('hard', H.ratePuzzle, rng);
    if (!res) continue;
    const g = res.puzzle.slice();
    for (let step = 0; step < 200 && g.some(v => v === 0); step++) {
      const moves = H.findMoves(g);
      if (!moves.length) break;
      for (const mv of moves) {
        for (const e of mv.eliminations) {
          assert.notStrictEqual(res.solution[e.index], e.val,
            `解答の値 ${e.val} を index ${e.index} から除去した [${mv.technique}]`);
        }
      }
      g[moves[0].row * 9 + moves[0].col] = moves[0].val;
    }
  }
});

/* ---------- ratePuzzle ---------- */

test('ratePuzzle: 完成盤は {solvable:true, rating:0}', () => {
  assert.deepStrictEqual(H.ratePuzzle(S.parseGrid(KNOWN_SOLUTION)), { solvable: true, rating: 0 });
});

test('ratePuzzle: 既知問題は手筋だけで解ける', () => {
  const r = H.ratePuzzle(S.parseGrid(KNOWN_PUZZLE));
  assert.strictEqual(r.solvable, true);
  assert.ok(r.rating > 0 && r.rating <= 5);
});

test('ratePuzzle: 仮置きが必要な盤面は solvable:false / rating:5', () => {
  const r = H.ratePuzzle(S.parseGrid(FIXTURES.trial.grid));
  assert.strictEqual(r.solvable, false);
  assert.strictEqual(r.rating, 5);
});

test('ratePuzzle: 入力の盤面を破壊しない', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  const before = g.slice();
  H.ratePuzzle(g);
  assert.deepStrictEqual(g, before);
});

test('ratePuzzle: レベルごとの rating が難易度帯に収まる', { timeout: 300000 }, () => {
  const rng = mulberry32(555);
  for (const levelKey of ['beginner', 'easy', 'medium', 'hard']) {
    const level = S.LEVELS[levelKey];
    const res = S.generatePuzzle(levelKey, H.ratePuzzle, rng);
    assert.ok(res);
    const r = H.ratePuzzle(res.puzzle);
    const rating = r.solvable ? r.rating : 5;
    assert.ok(rating >= level.ratingMin && rating <= level.ratingMax,
      `${levelKey}: rating ${rating} が [${level.ratingMin}, ${level.ratingMax}] の外`);
  }
});

/* ---------- buildCandMap ---------- */

test('buildCandMap: 埋まったマスは null / 空マスは候補の Set', () => {
  const g = S.parseGrid(KNOWN_PUZZLE);
  const map = H.buildCandMap(g);
  assert.strictEqual(map.length, 81);
  for (let i = 0; i < 81; i++) {
    if (g[i] !== 0) assert.strictEqual(map[i], null, `index ${i}`);
    else {
      assert.ok(map[i] instanceof Set);
      assert.deepStrictEqual(Array.from(map[i]).sort(), S.candidatesAt(g, i).sort());
    }
  }
});
