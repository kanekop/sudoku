/* 数独エンジン: 盤面生成・解答・一意性チェック・難易度判定
 * grid は長さ81の配列 (0 = 空マス, 1-9 = 数字)。index = row*9 + col
 */
(function (global) {
  'use strict';

  const N = 81;

  function rowOf(i) { return Math.floor(i / 9); }
  function colOf(i) { return i % 9; }
  function boxOf(i) { return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3); }

  // 各マスと同じ行・列・ブロックに属するマス(peer)の索引を前計算
  const PEERS = [];
  const UNITS = []; // 27ユニット: 行0-8, 列9-17, ブロック18-26
  (function precompute() {
    for (let u = 0; u < 9; u++) {
      const row = [], col = [], box = [];
      for (let k = 0; k < 9; k++) {
        row.push(u * 9 + k);
        col.push(k * 9 + u);
        const br = Math.floor(u / 3) * 3 + Math.floor(k / 3);
        const bc = (u % 3) * 3 + (k % 3);
        box.push(br * 9 + bc);
      }
      UNITS[u] = row; UNITS[9 + u] = col; UNITS[18 + u] = box;
    }
    for (let i = 0; i < N; i++) {
      const s = new Set();
      for (const unit of UNITS) {
        if (unit.includes(i)) unit.forEach(j => { if (j !== i) s.add(j); });
      }
      PEERS[i] = Array.from(s);
    }
  })();

  function candidatesAt(grid, i) {
    if (grid[i] !== 0) return [];
    const used = new Set();
    for (const p of PEERS[i]) if (grid[p] !== 0) used.add(grid[p]);
    const out = [];
    for (let v = 1; v <= 9; v++) if (!used.has(v)) out.push(v);
    return out;
  }

  function isValidPlacement(grid, i, v) {
    for (const p of PEERS[i]) if (grid[p] === v) return false;
    return true;
  }

  // 盤面全体の整合性(重複がないか)
  function findConflicts(grid) {
    const bad = new Set();
    for (const unit of UNITS) {
      const seen = {};
      for (const i of unit) {
        const v = grid[i];
        if (v === 0) continue;
        if (seen[v] !== undefined) { bad.add(i); bad.add(seen[v]); }
        else seen[v] = i;
      }
    }
    return Array.from(bad);
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // バックトラック解答。limit 個まで解を数える (一意性チェックは limit=2)
  // stats.nodes には探索中の分岐(仮置き)回数が積まれる — 問題の機械的難しさの指標
  function countSolutions(grid, limit, solutionOut, stats) {
    const g = grid.slice();
    let count = 0;
    function bt() {
      if (count >= limit) return;
      // 候補最少のマスを選ぶ (MRV)
      let best = -1, bestCands = null;
      for (let i = 0; i < N; i++) {
        if (g[i] !== 0) continue;
        const c = candidatesAt(g, i);
        if (c.length === 0) return; // 行き詰まり
        if (bestCands === null || c.length < bestCands.length) { best = i; bestCands = c; }
        if (bestCands.length === 1) break;
      }
      if (best === -1) { // 全マス埋まった
        count++;
        if (solutionOut && count === 1) for (let i = 0; i < N; i++) solutionOut[i] = g[i];
        return;
      }
      if (stats && bestCands.length > 1) stats.nodes += bestCands.length - 1;
      for (const v of bestCands) {
        g[best] = v;
        bt();
        g[best] = 0;
        if (count >= limit) return;
      }
    }
    bt();
    return count;
  }

  function solve(grid) {
    const sol = new Array(N).fill(0);
    const n = countSolutions(grid, 1, sol);
    return n >= 1 ? sol : null;
  }

  function hasUniqueSolution(grid) {
    return countSolutions(grid, 2, null) === 1;
  }

  // ランダムな完成盤を生成
  function generateFull(rng) {
    rng = rng || Math.random;
    const g = new Array(N).fill(0);
    function fill(i) {
      if (i === N) return true;
      const cands = shuffle(candidatesAt(g, i), rng);
      for (const v of cands) {
        g[i] = v;
        if (fill(i + 1)) return true;
        g[i] = 0;
      }
      return false;
    }
    fill(0);
    return g;
  }

  // レベル定義: targetClues = 残すヒント数の目安, maxRating = 人間手筋での難易度上限
  const LEVELS = {
    beginner: { label: '入門',   targetClues: 45, ratingMin: 0, ratingMax: 1.5 },
    easy:     { label: '初級',   targetClues: 38, ratingMin: 0, ratingMax: 1.5 },
    medium:   { label: '中級',   targetClues: 30, ratingMin: 1.0, ratingMax: 2.6 },
    hard:     { label: '上級',   targetClues: 26, ratingMin: 1.8, ratingMax: 4.2 },
    expert:   { label: '難問',   targetClues: 24, ratingMin: 2.5, ratingMax: 99 },
    oni:      { label: '鬼',     targetClues: 0,  ratingMin: 5,   ratingMax: 99 },
  };

  // 完成盤からマスを掘って問題を作る (点対称に掘る・一意解を維持)
  function digPuzzle(full, targetClues, rng) {
    rng = rng || Math.random;
    const g = full.slice();
    const order = shuffle(Array.from({ length: N }, (_, i) => i), rng);
    let clues = N;
    for (const i of order) {
      if (clues <= targetClues) break;
      const j = N - 1 - i; // 点対称の相方
      if (g[i] === 0) continue;
      const savedI = g[i], savedJ = g[j];
      g[i] = 0;
      let removed = 1;
      if (j !== i && g[j] !== 0) { g[j] = 0; removed++; }
      if (hasUniqueSolution(g)) {
        clues -= removed;
      } else {
        g[i] = savedI;
        if (j !== i) g[j] = savedJ;
      }
    }
    return g;
  }

  // 対称性を無視して「これ以上1マスも消せない」極小盤面まで掘る
  function digMinimal(full, rng) {
    rng = rng || Math.random;
    const g = full.slice();
    let changed = true;
    while (changed) {
      changed = false;
      const order = shuffle(Array.from({ length: N }, (_, i) => i).filter(i => g[i] !== 0), rng);
      for (const i of order) {
        const saved = g[i];
        g[i] = 0;
        if (hasUniqueSolution(g)) changed = true;
        else g[i] = saved;
      }
    }
    return g;
  }

  // 一意性証明に必要だった分岐回数 = 機械的な難しさの指標
  function searchEffort(grid) {
    const stats = { nodes: 0 };
    countSolutions(grid, 2, null, stats);
    return stats.nodes;
  }

  /* 鬼レベル: 極小盤面を複数生成し、
   * 「手筋で解けない」かつ「探索の試行錯誤が最も多い」ものを選ぶ */
  function generateExtreme(ratePuzzle, rng) {
    rng = rng || Math.random;
    let best = null, bestScore = -1;
    const TRIES = 12;
    for (let t = 0; t < TRIES; t++) {
      const full = generateFull(rng);
      const puzzle = digMinimal(full, rng);
      const clues = puzzle.filter(v => v !== 0).length;
      const solvableByTechniques = ratePuzzle ? ratePuzzle(puzzle).solvable : false;
      // 手筋で解ける問題は鬼としては不採用 (最後の保険としてのみ保持)
      const effort = searchEffort(puzzle);
      const score = (solvableByTechniques ? 0 : 100000) + effort * 10 + (81 - clues);
      if (score > bestScore) { bestScore = score; best = { puzzle, solution: full, rating: 5 }; }
      // 十分に難しいものが出たら早期終了
      if (!solvableByTechniques && effort >= 30) break;
    }
    return best;
  }

  /* 問題を生成する。
   * ratePuzzle(grid) => {rating, solvable} を外部(hints.js)から受け取り、
   * レベルの難易度帯に合う問題が出るまで再試行する。
   */
  function generatePuzzle(levelKey, ratePuzzle, rng) {
    rng = rng || Math.random;
    if (levelKey === 'oni') return generateExtreme(ratePuzzle, rng);
    const level = LEVELS[levelKey] || LEVELS.easy;
    let best = null, bestDist = Infinity;
    const MAX_TRIES = 24;
    for (let t = 0; t < MAX_TRIES; t++) {
      const full = generateFull(rng);
      const puzzle = digPuzzle(full, level.targetClues, rng);
      if (!ratePuzzle) return { puzzle, solution: full, rating: null };
      const r = ratePuzzle(puzzle);
      const rating = r.solvable ? r.rating : 5; // 手筋で解けない = 最難
      if (rating >= level.ratingMin && rating <= level.ratingMax) {
        return { puzzle, solution: full, rating };
      }
      const mid = (level.ratingMin + Math.min(level.ratingMax, 5)) / 2;
      const dist = Math.abs(rating - mid);
      if (dist < bestDist) { bestDist = dist; best = { puzzle, solution: full, rating }; }
    }
    return best;
  }

  function parseGrid(str) {
    // "530070000..." 形式 (81文字, 0 または . が空)
    const s = str.replace(/[^0-9.]/g, '');
    if (s.length !== N) return null;
    return Array.from(s, ch => (ch === '.' ? 0 : parseInt(ch, 10)));
  }

  function gridToString(grid) {
    return grid.map(v => String(v)).join('');
  }

  const api = {
    N, rowOf, colOf, boxOf, PEERS, UNITS,
    candidatesAt, isValidPlacement, findConflicts,
    countSolutions, solve, hasUniqueSolution,
    generateFull, digPuzzle, digMinimal, generatePuzzle, generateExtreme, searchEffort,
    LEVELS, parseGrid, gridToString,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Sudoku = api;
})(typeof window !== 'undefined' ? window : globalThis);
