/* 盤面生成の Web Worker。
 * 生成 (特に「鬼」) は同期処理で数百ms〜数秒かかるため、メインスレッドで回すと
 * UI が固まりスピナーのアニメーションまで止まる。この Worker で別スレッドへ逃がす。
 *
 * sudoku.js / hints.js は window が無い環境では globalThis (= Worker の self) に
 * API を生やすので、そのまま importScripts できる。
 *
 * 受信: { id, levelKey }
 * 返信: { id, ok: true, puzzle, solution, rating } / { id, ok: false, error }
 */
'use strict';

// ?v= は index.html のアセット参照と同じキャッシュバスティング用の版番号
importScripts('sudoku.js?v=2', 'hints.js?v=2');

self.onmessage = function (e) {
  const data = e.data || {};
  const id = data.id;
  try {
    const res = self.Sudoku.generatePuzzle(data.levelKey, self.SudokuHints.ratePuzzle);
    if (!res) { self.postMessage({ id, ok: false, error: 'generatePuzzle returned null' }); return; }
    self.postMessage({ id, ok: true, puzzle: res.puzzle, solution: res.solution, rating: res.rating });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) ? err.message : String(err) });
  }
};
