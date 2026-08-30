/* 指南エンジン: 人間の手筋で「次の一手」を探し、日本語の理由を付けて返す。
 * 依存: sudoku.js (Sudoku)
 *
 * findMoves(grid) => Move[] (難易度の易しい順)
 * Move = {
 *   row, col, val,            // 置くマスと数字 (0-indexed row/col)
 *   technique, techniqueLabel,
 *   difficulty,               // 1.0(易)〜5.0(難)
 *   reason,                   // 日本語の説明
 *   highlights: [index...],   // 根拠として光らせるマス
 *   eliminations: [{index, val}] // 前提となった候補除去(あれば)
 * }
 */
(function (global) {
  'use strict';

  const S = (typeof module !== 'undefined' && module.exports)
    ? require('./sudoku.js')
    : global.Sudoku;

  const ROWN = r => `${r + 1}行目`;
  const COLN = c => `${c + 1}列目`;
  const BOXN = b => `ブロック${['左上','中央上','右上','左中','中央','右中','左下','中央下','右下'][b]}`;
  const CELL = i => `(${S.rowOf(i) + 1}行, ${S.colOf(i) + 1}列)`;

  function unitName(u) {
    if (u < 9) return ROWN(u);
    if (u < 18) return COLN(u - 9);
    return BOXN(u - 18);
  }

  // 候補マップ candMap[i] = Set(候補)
  function buildCandMap(grid) {
    const m = new Array(81).fill(null);
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) m[i] = new Set(S.candidatesAt(grid, i));
    }
    return m;
  }

  /* ---------- 配置系の手筋 ---------- */

  function findNakedSingles(grid, candMap, out) {
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0 || candMap[i].size !== 1) continue;
      const val = candMap[i].values().next().value;
      // 排除している数字の出所を根拠として集める
      const sources = [];
      const seen = new Set();
      for (const p of S.PEERS[i]) {
        if (grid[p] !== 0 && !seen.has(grid[p])) { seen.add(grid[p]); sources.push(p); }
      }
      out.push({
        row: S.rowOf(i), col: S.colOf(i), val,
        technique: 'nakedSingle', techniqueLabel: '唯一の候補 (Naked Single)',
        difficulty: 1.0,
        reason: `${CELL(i)} には ${val} しか入りません。同じ行・列・ブロックに 1〜9 のうち ${val} 以外の数字がすべて既に置かれているためです。`,
        highlights: sources,
        eliminations: [],
      });
    }
  }

  function findHiddenSingles(grid, candMap, out, dedup) {
    for (let u = 0; u < 27; u++) {
      const unit = S.UNITS[u];
      for (let v = 1; v <= 9; v++) {
        const spots = unit.filter(i => grid[i] === 0 && candMap[i].has(v));
        if (spots.length !== 1) continue;
        const i = spots[0];
        const key = i + ':' + v;
        if (dedup.has(key)) continue;
        dedup.add(key);
        // このユニットの他の空マスに v が入れない理由 = それぞれのpeerにあるv
        const blockers = new Set();
        for (const j of unit) {
          if (j === i || grid[j] !== 0) continue;
          for (const p of S.PEERS[j]) if (grid[p] === v) { blockers.add(p); break; }
        }
        out.push({
          row: S.rowOf(i), col: S.colOf(i), val: v,
          technique: 'hiddenSingle', techniqueLabel: '隠れたシングル (Hidden Single)',
          difficulty: 1.2,
          reason: `${unitName(u)}で ${v} が入れるマスは ${CELL(i)} だけです。${unitName(u)}の他の空きマスはどれも、同じ行・列・ブロックに既にある ${v} と衝突します。`,
          highlights: Array.from(blockers),
          eliminations: [],
        });
      }
    }
  }

  /* ---------- 候補除去系の手筋 (candMap を直接削る) ----------
   * 各関数は除去できたら {技法情報, eliminations} を返し、できなければ null
   */

  // 予約 (Locked Candidates / Pointing・Claiming)
  function applyLockedCandidates(grid, candMap) {
    for (let b = 0; b < 9; b++) {
      const box = S.UNITS[18 + b];
      for (let v = 1; v <= 9; v++) {
        const spots = box.filter(i => grid[i] === 0 && candMap[i].has(v));
        if (spots.length < 2 || spots.length > 3) continue;
        const rows = new Set(spots.map(S.rowOf));
        const cols = new Set(spots.map(S.colOf));
        let line = null, lineLabel = null;
        if (rows.size === 1) { line = S.UNITS[rows.values().next().value]; lineLabel = ROWN(rows.values().next().value); }
        else if (cols.size === 1) { line = S.UNITS[9 + cols.values().next().value]; lineLabel = COLN(cols.values().next().value); }
        if (!line) continue;
        const elims = [];
        for (const i of line) {
          if (grid[i] === 0 && !spots.includes(i) && candMap[i].has(v)) {
            candMap[i].delete(v);
            elims.push({ index: i, val: v });
          }
        }
        if (elims.length) {
          return {
            technique: 'lockedCandidates', techniqueLabel: '予約 (Locked Candidates)',
            difficulty: 2.0,
            desc: `${BOXN(b)}内で ${v} が入りうるマスはすべて${lineLabel}に並んでいます。よって${lineLabel}のブロック外のマスから候補 ${v} を除外できます。`,
            highlights: spots.slice(),
            eliminations: elims,
          };
        }
      }
    }
    return null;
  }

  // 裸のペア/トリプル (Naked Pair / Triple)
  function applyNakedSets(grid, candMap, size) {
    for (let u = 0; u < 27; u++) {
      const unit = S.UNITS[u];
      const empties = unit.filter(i => grid[i] === 0 && candMap[i].size >= 2 && candMap[i].size <= size);
      if (empties.length < size) continue;
      const combos = kCombinations(empties, size);
      for (const combo of combos) {
        const union = new Set();
        combo.forEach(i => candMap[i].forEach(v => union.add(v)));
        if (union.size !== size) continue;
        const elims = [];
        for (const i of unit) {
          if (grid[i] !== 0 || combo.includes(i)) continue;
          for (const v of union) {
            if (candMap[i].has(v)) { candMap[i].delete(v); elims.push({ index: i, val: v }); }
          }
        }
        if (elims.length) {
          const vals = Array.from(union).sort().join('・');
          const name = size === 2 ? 'ペア' : 'トリプル';
          return {
            technique: 'nakedSet' + size, techniqueLabel: `裸の${name} (Naked ${size === 2 ? 'Pair' : 'Triple'})`,
            difficulty: size === 2 ? 2.5 : 3.2,
            desc: `${unitName(u)}の ${combo.map(CELL).join(' と ')} は候補が ${vals} だけの組です。この${size}マスで ${vals} を使い切るため、${unitName(u)}の他のマスから候補 ${vals} を除外できます。`,
            highlights: combo.slice(),
            eliminations: elims,
          };
        }
      }
    }
    return null;
  }

  // 隠れたペア (Hidden Pair)
  function applyHiddenPairs(grid, candMap) {
    for (let u = 0; u < 27; u++) {
      const unit = S.UNITS[u];
      for (let a = 1; a <= 8; a++) {
        for (let b = a + 1; b <= 9; b++) {
          const spotsA = unit.filter(i => grid[i] === 0 && candMap[i].has(a));
          const spotsB = unit.filter(i => grid[i] === 0 && candMap[i].has(b));
          if (spotsA.length !== 2 || spotsB.length !== 2) continue;
          if (spotsA[0] !== spotsB[0] || spotsA[1] !== spotsB[1]) continue;
          const elims = [];
          for (const i of spotsA) {
            for (const v of Array.from(candMap[i])) {
              if (v !== a && v !== b) { candMap[i].delete(v); elims.push({ index: i, val: v }); }
            }
          }
          if (elims.length) {
            return {
              technique: 'hiddenPair', techniqueLabel: '隠れたペア (Hidden Pair)',
              difficulty: 3.0,
              desc: `${unitName(u)}で ${a} と ${b} が入れるのは ${spotsA.map(CELL).join(' と ')} の2マスだけです。この2マスは ${a}・${b} で確定するため、他の候補を除外できます。`,
              highlights: spotsA.slice(),
              eliminations: elims,
            };
          }
        }
      }
    }
    return null;
  }

  // X-Wing
  function applyXWing(grid, candMap) {
    for (const base of ['row', 'col']) {
      for (let v = 1; v <= 9; v++) {
        const lines = [];
        for (let u = 0; u < 9; u++) {
          const unit = base === 'row' ? S.UNITS[u] : S.UNITS[9 + u];
          const spots = unit.filter(i => grid[i] === 0 && candMap[i].has(v));
          if (spots.length === 2) lines.push({ u, spots });
        }
        for (let x = 0; x < lines.length; x++) {
          for (let y = x + 1; y < lines.length; y++) {
            const A = lines[x], B = lines[y];
            const crossA = A.spots.map(base === 'row' ? S.colOf : S.rowOf);
            const crossB = B.spots.map(base === 'row' ? S.colOf : S.rowOf);
            if (crossA[0] !== crossB[0] || crossA[1] !== crossB[1]) continue;
            const elims = [];
            for (const cu of crossA) {
              const unit = base === 'row' ? S.UNITS[9 + cu] : S.UNITS[cu];
              for (const i of unit) {
                if (grid[i] === 0 && candMap[i].has(v) &&
                    !A.spots.includes(i) && !B.spots.includes(i)) {
                  candMap[i].delete(v);
                  elims.push({ index: i, val: v });
                }
              }
            }
            if (elims.length) {
              const baseLabel = base === 'row' ? `${ROWN(A.u)}と${ROWN(B.u)}` : `${COLN(A.u)}と${COLN(B.u)}`;
              const crossLabel = base === 'row' ? `${COLN(crossA[0])}と${COLN(crossA[1])}` : `${ROWN(crossA[0])}と${ROWN(crossA[1])}`;
              return {
                technique: 'xwing', techniqueLabel: 'X-Wing',
                difficulty: 4.0,
                desc: `${baseLabel}では ${v} の入り得る位置が${crossLabel}の交点4マスに限られ、長方形を成しています。どちらに決まっても${crossLabel}の ${v} はこの4マス内で使われるため、同じ${base === 'row' ? '列' : '行'}上の他のマスから候補 ${v} を除外できます。`,
                highlights: A.spots.concat(B.spots),
                eliminations: elims,
              };
            }
          }
        }
      }
    }
    return null;
  }

  function kCombinations(arr, k) {
    const out = [];
    (function rec(start, combo) {
      if (combo.length === k) { out.push(combo.slice()); return; }
      for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); }
    })(0, []);
    return out;
  }

  const ELIMINATORS = [applyLockedCandidates,
    (g, m) => applyNakedSets(g, m, 2),
    applyHiddenPairs,
    (g, m) => applyNakedSets(g, m, 3),
    applyXWing];

  /* 次の一手の候補一覧を返す (易しい順)。
   * まず素の盤面でシングルを探し、無ければ除去手筋を最大 depth 回適用して
   * シングルが生まれるまで候補を絞り、その経緯を理由に含める。
   */
  function findMoves(grid) {
    const out = [];
    const dedup = new Set();
    let candMap = buildCandMap(grid);
    findNakedSingles(grid, candMap, out);
    findHiddenSingles(grid, candMap, out, dedup);
    if (out.length) {
      out.sort((a, b) => a.difficulty - b.difficulty);
      return dedupMoves(out);
    }

    // シングルが無い → 除去手筋を積み重ねる
    const applied = [];
    for (let depth = 0; depth < 8; depth++) {
      let progressed = false;
      for (const elim of ELIMINATORS) {
        const res = elim(grid, candMap);
        if (res) { applied.push(res); progressed = true; break; }
      }
      if (!progressed) break;
      const found = [];
      findNakedSingles(grid, candMap, found);
      findHiddenSingles(grid, candMap, found, new Set());
      if (found.length) {
        const chain = applied.map((a, k) => `【手順${k + 1}: ${a.techniqueLabel}】${a.desc}`).join('\n');
        const maxDiff = Math.max(...applied.map(a => a.difficulty));
        for (const mv of found) {
          mv.difficulty = Math.max(mv.difficulty, maxDiff);
          mv.techniqueLabel = applied[applied.length - 1].techniqueLabel + ' → ' + mv.techniqueLabel;
          mv.reason = chain + '\nこの絞り込みの結果 — ' + mv.reason;
          mv.highlights = mv.highlights.concat(...applied.map(a => a.highlights));
          mv.eliminations = applied.flatMap(a => a.eliminations);
        }
        found.sort((a, b) => a.difficulty - b.difficulty);
        return dedupMoves(found);
      }
    }

    // 手筋で見つからない → 解答から提示 (仮置きが必要な超難問)
    const sol = S.solve(grid);
    if (!sol) return [];
    let bestI = -1, bestSize = 10;
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0 && candMap[i].size < bestSize) { bestI = i; bestSize = candMap[i].size; }
    }
    if (bestI === -1) return [];
    return [{
      row: S.rowOf(bestI), col: S.colOf(bestI), val: sol[bestI],
      technique: 'trial', techniqueLabel: '仮置き (Trial & Error)',
      difficulty: 5.0,
      reason: `ここから先は単純な手筋では進めない超難問です。${CELL(bestI)} は候補が${bestSize}個と最も少ないマスです。仮置きして矛盾を探すと、${sol[bestI]} だけが矛盾なく成立します。`,
      highlights: [],
      eliminations: [],
    }];
  }

  function dedupMoves(moves) {
    const seen = new Set();
    return moves.filter(m => {
      const k = m.row * 9 + m.col + ':' + m.val;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* 難易度判定: 手筋だけで最後まで解けるか、必要だった手筋の最高難度は何か */
  function ratePuzzle(grid) {
    const g = grid.slice();
    let maxDiff = 0;
    for (let guard = 0; guard < 200; guard++) {
      if (g.every(v => v !== 0)) return { solvable: true, rating: maxDiff };
      const moves = findMoves(g);
      if (!moves.length) return { solvable: false, rating: 5 };
      const mv = moves[0];
      if (mv.technique === 'trial') return { solvable: false, rating: 5 };
      maxDiff = Math.max(maxDiff, mv.difficulty);
      g[mv.row * 9 + mv.col] = mv.val;
    }
    return { solvable: false, rating: 5 };
  }

  // 除去系の手筋は単体テストから直接呼べるよう公開する
  // (findMoves のカスケードでは前段の手筋が先に発火して到達しないことがあるため)
  const api = {
    findMoves, ratePuzzle, buildCandMap,
    applyLockedCandidates, applyNakedSets, applyHiddenPairs, applyXWing,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SudokuHints = api;
})(typeof window !== 'undefined' ? window : globalThis);
