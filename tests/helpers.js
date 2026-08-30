/* テスト用の共通ヘルパー。依存ゼロ (Node 標準のみ)。 */
'use strict';

/* 決定的な擬似乱数 (mulberry32)。
 * sudoku.js の生成系は rng を引数で受け取る設計なので、
 * これを渡すことでテストを再現可能にする。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 既知の一意解問題 (Project Euler 96 / 定番の "530070000...") */
const KNOWN_PUZZLE =
  '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const KNOWN_SOLUTION =
  '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

/* KNOWN_PUZZLE から index 25 の clue を1つ抜いた盤面 = 解が2つ */
const TWO_SOLUTION_PUZZLE =
  '530070000600195000098000000800060003400803001700020006060000280000419005000080079';

module.exports = { mulberry32, KNOWN_PUZZLE, KNOWN_SOLUTION, TWO_SOLUTION_PUZZLE };
