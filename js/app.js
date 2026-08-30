/* アプリ本体: UI・状態管理・保存 */
(function () {
  'use strict';

  const S = window.Sudoku, H = window.SudokuHints;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const LS = {
    NAME: 'sudoku.userName',
    SAVE: 'sudoku.save',
    LEVEL: 'sudoku.level',
    STATS: 'sudoku.stats',
  };

  const LEVEL_EN = { beginner: 'Beginner', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', oni: 'Extreme', imported: 'Imported' };

  /* ---------- 状態 ---------- */
  const state = {
    puzzle: null,      // 出題時の盤面 (0=空)
    solution: null,    // 解答 (nullあり: 複数解の取込問題)
    current: null,     // 現在の盤面
    notes: null,       // Array(81) of Set
    levelKey: 'easy',
    levelLabel: '初級',
    selected: -1,
    noteMode: false,
    history: [],
    startTs: 0,        // 経過時間計算用
    elapsedBase: 0,    // 再開時の持ち越し秒
    timerId: 0,
    finished: false,
    hintMoves: null,
    hintIdx: 0,
  };

  /* ---------- ユーティリティ ---------- */
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function elapsedSec() {
    return state.elapsedBase + (state.startTs ? Math.floor((Date.now() - state.startTs) / 1000) : 0);
  }
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  /* ---------- localStorage ----------
   * Safari のプライベートブラウズ・容量超過・ストレージ無効化では例外が飛ぶ。
   * 保存できなくても操作は続けられるべきなので、ここで吸収して一度だけ知らせる。 */
  let lsWarned = false;
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) {
      if (!lsWarned) { lsWarned = true; toast('この環境では進行状況を保存できません'); }
      return false;
    }
  }
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  /* ---------- 保存/復元 ---------- */
  function saveGame() {
    if (!state.current || state.finished) { lsRemove(LS.SAVE); return; }
    lsSet(LS.SAVE, JSON.stringify({
      puzzle: state.puzzle, solution: state.solution, current: state.current,
      notes: state.notes.map(s => Array.from(s)),
      levelKey: state.levelKey, levelLabel: state.levelLabel,
      elapsed: elapsedSec(),
    }));
  }
  // 長さ81・全要素が 0〜9 の整数か
  function isValidGridArray(a) {
    return Array.isArray(a) && a.length === 81 &&
      a.every(v => Number.isInteger(v) && v >= 0 && v <= 9);
  }

  /* 保存データの妥当性検査。
   * 旧バージョンの保存や手で壊された JSON で「復元は成功したが盤面が壊れている」
   * 状態になるのを防ぐ。1つでも欠けたら保存を捨てて新規出題へ回す。 */
  function isValidSave(d) {
    if (!d || typeof d !== 'object') return false;
    if (!isValidGridArray(d.puzzle) || !isValidGridArray(d.current)) return false;
    // 出題済みのマスは書き換えられないはずなので、一致していなければ壊れている
    for (let i = 0; i < 81; i++) {
      if (d.puzzle[i] !== 0 && d.current[i] !== d.puzzle[i]) return false;
    }
    if (!Array.isArray(d.notes) || d.notes.length !== 81) return false;
    if (!d.notes.every(a => Array.isArray(a) &&
        a.every(v => Number.isInteger(v) && v >= 1 && v <= 9))) return false;
    if (d.solution != null && !isValidGridArray(d.solution)) return false;
    if (typeof d.levelKey !== 'string' || !d.levelKey) return false;
    if (typeof d.levelLabel !== 'string' || !d.levelLabel) return false;
    return true;
  }

  function loadGame() {
    let d = null;
    try {
      const raw = lsGet(LS.SAVE);
      if (!raw) return false;
      d = JSON.parse(raw);
    } catch (e) { d = null; }
    if (!isValidSave(d)) {
      lsRemove(LS.SAVE); // 壊れた保存を毎回読みに行かない
      return false;
    }
    state.puzzle = d.puzzle; state.solution = d.solution || null; state.current = d.current;
    state.notes = d.notes.map(a => new Set(a));
    state.levelKey = d.levelKey; state.levelLabel = d.levelLabel;
    state.elapsedBase = Number.isFinite(d.elapsed) && d.elapsed > 0 ? Math.floor(d.elapsed) : 0;
    state.finished = false;
    state.history = [];
    return true;
  }

  /* ---------- 盤面描画 ---------- */
  const boardEl = $('#board');
  const cellEls = [];
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const div = document.createElement('div');
      div.className = 'cell';
      const r = S.rowOf(i), c = S.colOf(i);
      if (r % 3 === 0) div.classList.add('bt');
      if (c % 3 === 0) div.classList.add('bl');
      if (r === 8) div.classList.add('bb');
      if (c === 8) div.classList.add('br');
      div.addEventListener('pointerdown', () => selectCell(i));
      boardEl.appendChild(div);
      cellEls.push(div);
    }
  }

  function render() {
    if (!state.current) return;
    const conflicts = new Set(S.findConflicts(state.current));
    const selVal = state.selected >= 0 ? state.current[state.selected] : 0;
    const counts = new Array(10).fill(0);
    state.current.forEach(v => counts[v]++);

    for (let i = 0; i < 81; i++) {
      const el = cellEls[i];
      const v = state.current[i];
      el.classList.toggle('given', state.puzzle[i] !== 0);
      el.classList.toggle('selected', i === state.selected);
      el.classList.toggle('conflict', conflicts.has(i));
      el.classList.toggle('same', selVal !== 0 && v === selVal && i !== state.selected);
      el.classList.toggle('peer', state.selected >= 0 && S.PEERS[state.selected].includes(i));
      if (v !== 0) {
        el.textContent = v;
        el.classList.remove('notes');
      } else if (state.notes[i].size) {
        el.classList.add('notes');
        el.innerHTML = Array.from({ length: 9 }, (_, k) =>
          `<span>${state.notes[i].has(k + 1) ? k + 1 : ''}</span>`).join('');
      } else {
        el.textContent = '';
        el.classList.remove('notes');
      }
    }
    // 数字パッドの残数
    $$('#numpad button[data-num]').forEach(b => {
      const n = parseInt(b.dataset.num, 10);
      b.classList.toggle('done', counts[n] >= 9);
      b.querySelector('.count').textContent = Math.max(0, 9 - counts[n]);
    });
    $('#levelBadge').textContent = state.levelLabel;
    $('#noteBtn').classList.toggle('active', state.noteMode);
  }

  function clearHintHighlights() {
    cellEls.forEach(el => el.classList.remove('hint-target', 'hint-basis'));
  }

  /* ---------- 入力 ---------- */
  function selectCell(i) {
    state.selected = i;
    render();
  }

  function pushHistory() {
    state.history.push({
      current: state.current.slice(),
      notes: state.notes.map(s => new Set(s)),
    });
    if (state.history.length > 200) state.history.shift();
  }

  function inputNumber(n) {
    const i = state.selected;
    if (i < 0 || !state.current || state.finished) return;
    if (state.puzzle[i] !== 0) { toast('最初から置かれている数字は変更できません'); return; }
    pushHistory();
    if (state.noteMode) {
      if (state.current[i] !== 0) return;
      if (state.notes[i].has(n)) state.notes[i].delete(n); else state.notes[i].add(n);
    } else {
      state.current[i] = state.current[i] === n ? 0 : n;
      state.notes[i].clear();
      if (state.current[i] !== 0) {
        // 同じ行・列・ブロックのメモから n を消す
        for (const p of S.PEERS[i]) state.notes[p].delete(n);
      }
    }
    render(); saveGame(); checkComplete();
  }

  function eraseCell() {
    const i = state.selected;
    if (i < 0 || state.finished || state.puzzle[i] !== 0) return;
    pushHistory();
    state.current[i] = 0;
    state.notes[i].clear();
    render(); saveGame();
  }

  function undo() {
    const h = state.history.pop();
    if (!h) { toast('これ以上戻れません'); return; }
    state.current = h.current;
    state.notes = h.notes;
    render(); saveGame();
  }

  document.addEventListener('keydown', (e) => {
    if ($('.modal.open')) return;
    if (e.key >= '1' && e.key <= '9') { inputNumber(parseInt(e.key, 10)); return; }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { eraseCell(); return; }
    if (e.key === 'n' || e.key === 'N') { state.noteMode = !state.noteMode; render(); return; }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); return; }
    const d = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (d !== undefined) {
      e.preventDefault();
      if (state.selected < 0) { selectCell(40); return; }
      // 左右は行端で止める (i-1 / i+1 だと隣の行へ回り込んで誤入力の元になる)
      const col = S.colOf(state.selected);
      if (d === -1 && col === 0) return;
      if (d === 1 && col === 8) return;
      const i = state.selected + d; // 上下は 0..80 の範囲チェックで止まる
      if (i >= 0 && i < 81) selectCell(i);
    }
  });

  /* ---------- タイマー ---------- */
  function startTimer() {
    stopTimer();
    state.startTs = Date.now();
    state.timerId = setInterval(() => { $('#timer').textContent = fmtTime(elapsedSec()); }, 1000);
    $('#timer').textContent = fmtTime(elapsedSec());
  }
  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    if (state.startTs) { state.elapsedBase = elapsedSec(); state.startTs = 0; }
    state.timerId = 0;
  }

  /* ---------- ゲーム開始/完了 ---------- */
  function startGame(puzzle, solution, levelKey, levelLabel) {
    state.puzzle = puzzle.slice();
    state.solution = solution ? solution.slice() : null;
    state.current = puzzle.slice();
    state.notes = Array.from({ length: 81 }, () => new Set());
    state.levelKey = levelKey; state.levelLabel = levelLabel;
    state.history = [];
    state.selected = -1;
    state.finished = false;
    state.elapsedBase = 0;
    clearHintHighlights();
    startTimer();
    render(); saveGame();
  }

  /* ---------- 問題の生成 (Web Worker) ----------
   * 生成は同期処理で数百ms〜数秒かかる。メインスレッドで回すと UI が固まるため
   * Worker へ逃がす。Worker が使えない環境 (file:// 起動など) は
   * 従来どおりメインスレッドで生成する。 */
  const gen = {
    worker: null,
    broken: false,   // Worker を諦めた (二度と作り直さない)
    seq: 0,          // 発行した生成リクエストの通し番号
    pending: null,   // { id, levelKey, finish }
  };

  function getGenWorker() {
    if (gen.broken) return null;
    if (gen.worker) return gen.worker;
    try {
      // ?v= は index.html のアセット参照と同じキャッシュバスティング用の版番号
      const w = new Worker('js/generator-worker.js?v=2');
      w.onmessage = (e) => {
        const d = e.data || {};
        const p = gen.pending;
        if (!p || d.id !== p.id) return; // 中止済み / 古い結果
        gen.pending = null;
        p.finish(d.ok ? { puzzle: d.puzzle, solution: d.solution } : null);
      };
      w.onerror = (ev) => {
        // Worker スクリプトを読み込めない環境 → 以後はメインスレッドで生成
        if (ev && ev.preventDefault) ev.preventDefault();
        gen.broken = true;
        try { w.terminate(); } catch (_) { /* noop */ }
        gen.worker = null;
        const p = gen.pending;
        gen.pending = null;
        if (p) generateOnMainThread(p);
      };
      gen.worker = w;
    } catch (_) {
      gen.broken = true;
      gen.worker = null;
    }
    return gen.worker;
  }

  function generateOnMainThread(p) {
    // スピナーを1フレーム描かせてから同期生成に入る
    setTimeout(() => {
      if (p.id !== gen.seq) return;
      p.finish(S.generatePuzzle(p.levelKey, H.ratePuzzle));
    }, 30);
  }

  function newGame(levelKey) {
    const level = S.LEVELS[levelKey] || S.LEVELS.easy;
    /* 前の生成がまだ走っていたら、そのスレッドごと捨てる。
     * Worker はメッセージを直列に処理するので、捨てないと新しい要求が
     * 前の生成 (最悪ケースの「鬼」など) の完了を待たされる。 */
    if (gen.pending && gen.worker) {
      try { gen.worker.terminate(); } catch (_) { /* noop */ }
      gen.worker = null;
    }
    const id = ++gen.seq;
    openModal('#loadingModal');
    $('#loadingText').textContent = `${level.label}の問題を作成中…`;
    // 進行中のゲームが無い(初回起動)ときは中止しても行き先が無いので隠す
    $('#cancelGenBtn').style.display = state.current ? '' : 'none';

    const p = {
      id, levelKey,
      finish: (res) => {
        if (id !== gen.seq) return; // 中止済み / 新しい要求に置き換わった
        gen.pending = null;
        closeModal('#loadingModal');
        if (!res || !res.puzzle) { toast('問題の生成に失敗しました。もう一度お試しください'); return; }
        lsSet(LS.LEVEL, levelKey);
        startGame(res.puzzle, res.solution, levelKey, level.label);
        toast(`${level.label}の新しい問題です。がんばって!`);
      },
    };
    gen.pending = p;

    const w = getGenWorker();
    if (w) w.postMessage({ id, levelKey });
    else generateOnMainThread(p);
  }

  function cancelGeneration() {
    if (!gen.pending) { closeModal('#loadingModal'); return; }
    gen.seq++;          // 進行中の結果を無効化する
    gen.pending = null;
    if (gen.worker) {   // 走りっぱなしのスレッドを止める (停止した Worker は再利用不可)
      try { gen.worker.terminate(); } catch (_) { /* noop */ }
      gen.worker = null;
    }
    closeModal('#loadingModal');
    toast('問題の作成を中止しました');
  }

  function checkComplete() {
    if (!state.current.every(v => v !== 0)) return;
    if (S.findConflicts(state.current).length > 0) return;
    state.finished = true;
    stopTimer();
    lsRemove(LS.SAVE);
    const t = fmtTime(state.elapsedBase);
    const name = lsGet(LS.NAME) || '';
    $('#winText').textContent = `${name ? name + 'さん、' : ''}クリアおめでとうございます! タイム: ${t} (${state.levelLabel})`;
    openModal('#winModal');
  }

  /* ---------- ヒント ---------- */
  function showHint(nextIdx) {
    if (!state.current || state.finished) return;
    if (S.findConflicts(state.current).length > 0) {
      toast('盤面に矛盾があります。まず「チェック」で間違いを直してください');
      return;
    }
    if (nextIdx === undefined) {
      state.hintMoves = H.findMoves(state.current);
      state.hintIdx = 0;
    } else {
      state.hintIdx = nextIdx % state.hintMoves.length;
    }
    const moves = state.hintMoves;
    if (!moves || !moves.length) { toast('ヒントが見つかりませんでした'); return; }
    const mv = moves[state.hintIdx];
    const i = mv.row * 9 + mv.col;

    clearHintHighlights();
    cellEls[i].classList.add('hint-target');
    (mv.highlights || []).forEach(j => { if (j !== i) cellEls[j].classList.add('hint-basis'); });

    $('#hintTechnique').textContent = mv.techniqueLabel;
    $('#hintStars').textContent = '★'.repeat(Math.round(mv.difficulty)) + '☆'.repeat(Math.max(0, 5 - Math.round(mv.difficulty)));
    $('#hintPlace').textContent = `${mv.row + 1}行 ${mv.col + 1}列 に ${mv.val}`;
    $('#hintReason').innerHTML = mv.reason.split('\n').map(esc => escapeHtml(esc)).join('<br>');
    $('#hintCounter').textContent = `${state.hintIdx + 1} / ${moves.length} 手目`;
    $('#altHintBtn').disabled = moves.length < 2;
    openModal('#hintModal');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function applyHint() {
    const mv = state.hintMoves && state.hintMoves[state.hintIdx];
    if (!mv) return;
    closeModal('#hintModal');
    state.selected = mv.row * 9 + mv.col;
    state.noteMode = false;
    inputNumber(mv.val);
    setTimeout(clearHintHighlights, 1500);
  }

  /* ---------- チェック ---------- */
  function checkMistakes() {
    if (!state.current) return;
    let wrong = 0;
    if (state.solution) {
      for (let i = 0; i < 81; i++) {
        const el = cellEls[i];
        el.classList.remove('wrong');
        if (state.current[i] !== 0 && state.puzzle[i] === 0 && state.current[i] !== state.solution[i]) {
          el.classList.add('wrong'); wrong++;
        }
      }
    } else {
      const conflicts = S.findConflicts(state.current);
      conflicts.forEach(i => cellEls[i].classList.add('wrong'));
      wrong = conflicts.length;
    }
    toast(wrong === 0 ? '今のところ間違いはありません!' : `${wrong}マスが間違っています (赤色表示)`);
    // 3秒以内に再チェックすると、前回のタイマーが新しい赤ハイライトを即座に消してしまう
    clearTimeout(checkMistakes._t);
    checkMistakes._t = setTimeout(() => cellEls.forEach(el => el.classList.remove('wrong')), 3000);
  }

  /* ---------- ユーザー名 ---------- */
  function initUser() {
    const name = lsGet(LS.NAME);
    if (name) {
      $('#userName').textContent = name + ' さん';
    } else {
      openModal('#nameModal');
    }
  }
  $('#nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#nameInput').value.trim();
    if (name) {
      lsSet(LS.NAME, name);
      $('#userName').textContent = name + ' さん';
    }
    closeModal('#nameModal');
  });
  $('#userName').addEventListener('click', () => {
    $('#nameInput').value = lsGet(LS.NAME) || '';
    openModal('#nameModal');
  });

  /* ---------- 画像取込 ---------- */
  const imp = { img: null, corners: null, dispScale: 1, grid: null, dragIdx: -1 };
  const impCanvas = $('#importCanvas');

  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const img = new Image();
    // revoke しないと Blob URL とデコード済み画像がセッション終了まで解放されない。
    // デコード後 (onload 以降) なら revoke しても描画に影響しない。
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      imp.img = img;
      const m = 0.04;
      imp.corners = [
        { x: img.naturalWidth * m, y: img.naturalHeight * m },
        { x: img.naturalWidth * (1 - m), y: img.naturalHeight * m },
        { x: img.naturalWidth * (1 - m), y: img.naturalHeight * (1 - m) },
        { x: img.naturalWidth * m, y: img.naturalHeight * (1 - m) },
      ];
      $('#importStep1').style.display = '';
      $('#importStep2').style.display = 'none';
      openModal('#importModal');
      requestAnimationFrame(drawImportCanvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('画像を読み込めませんでした'); };
    img.src = url;
  });

  function drawImportCanvas() {
    if (!imp.img) return;
    const maxW = Math.min(impCanvas.parentElement.clientWidth - 4, 640);
    const scale = Math.min(maxW / imp.img.naturalWidth, 480 / imp.img.naturalHeight);
    imp.dispScale = scale;
    impCanvas.width = Math.round(imp.img.naturalWidth * scale);
    impCanvas.height = Math.round(imp.img.naturalHeight * scale);
    const ctx = impCanvas.getContext('2d');
    ctx.drawImage(imp.img, 0, 0, impCanvas.width, impCanvas.height);
    // 四隅と枠 + 3x3の目安線
    const pts = imp.corners.map(p => ({ x: p.x * scale, y: p.y * scale }));
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, k) => k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
    const map = window.SudokuOCR.squareToQuad(pts);
    for (let k = 1; k < 3; k++) {
      const t = k / 3;
      line(ctx, map(t, 0), map(t, 1));
      line(ctx, map(0, t), map(1, t));
    }
    pts.forEach(p => {
      ctx.fillStyle = 'rgba(37, 99, 235, 0.95)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }
  function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

  function canvasPos(ev) {
    const rect = impCanvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) * (impCanvas.width / rect.width),
             y: (ev.clientY - rect.top) * (impCanvas.height / rect.height) };
  }
  impCanvas.addEventListener('pointerdown', (ev) => {
    const p = canvasPos(ev);
    let best = -1, bestD = 30 * 30;
    imp.corners.forEach((c, k) => {
      const dx = c.x * imp.dispScale - p.x, dy = c.y * imp.dispScale - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    });
    imp.dragIdx = best;
    if (best >= 0) impCanvas.setPointerCapture(ev.pointerId);
  });
  impCanvas.addEventListener('pointermove', (ev) => {
    if (imp.dragIdx < 0 || !imp.img) return;
    ev.preventDefault();
    const p = canvasPos(ev);
    const next = imp.corners.slice();
    next[imp.dragIdx] = {
      x: Math.max(0, Math.min(imp.img.naturalWidth, p.x / imp.dispScale)),
      y: Math.max(0, Math.min(imp.img.naturalHeight, p.y / imp.dispScale)),
    };
    // 3点が一直線・2点が重なるような退化した四隅は受け付けない
    // (射影変換が発散し、真っ白/崩れた画像で認識0個になるため)
    // 小さく切り出すこと自体は正当なので下限は緩め。狙いは潰れた四角形だけを弾くこと
    const minEdge = Math.max(8, Math.min(imp.img.naturalWidth, imp.img.naturalHeight) * 0.02);
    if (!window.SudokuOCR.isConvexQuad(next, minEdge)) return;
    imp.corners = next;
    drawImportCanvas();
  });
  impCanvas.addEventListener('pointerup', () => { imp.dragIdx = -1; });

  $('#recognizeBtn').addEventListener('click', async () => {
    $('#recognizeBtn').disabled = true;
    $('#importProgress').textContent = 'OCRエンジンを準備中…';
    try {
      const { grid, uncertain } = await window.SudokuOCR.recognizeGrid(
        imp.img, imp.corners,
        (done, total) => { $('#importProgress').textContent = `数字を認識中… ${done}/${total}`; });
      imp.grid = grid;
      buildReviewGrid(grid, uncertain);
      $('#importStep1').style.display = 'none';
      $('#importStep2').style.display = '';
      const n = grid.filter(v => v !== 0).length;
      $('#importProgress').textContent = '';
      $('#reviewInfo').textContent =
        `${n}個の数字を認識しました。誤りがあればタップして直してください` +
        (uncertain.length ? `(黄色は自信のないマス: ${uncertain.length}個)` : '') + '。';
    } catch (err) {
      $('#importProgress').textContent = '';
      toast('認識に失敗しました: ' + err.message);
    } finally {
      $('#recognizeBtn').disabled = false;
    }
  });

  function buildReviewGrid(grid, uncertain) {
    const wrap = $('#reviewGrid');
    wrap.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.maxLength = 1;
      inp.value = grid[i] === 0 ? '' : String(grid[i]);
      const r = S.rowOf(i), c = S.colOf(i);
      if (r % 3 === 0) inp.classList.add('bt');
      if (c % 3 === 0) inp.classList.add('bl');
      if (r === 8) inp.classList.add('bb');
      if (c === 8) inp.classList.add('br');
      if (uncertain && uncertain.includes(i)) inp.classList.add('uncertain');
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^1-9]/g, '').slice(0, 1);
        inp.classList.remove('uncertain');
      });
      wrap.appendChild(inp);
    }
  }

  $('#startImportedBtn').addEventListener('click', () => {
    const grid = Array.from($('#reviewGrid').children, inp =>
      inp.value === '' ? 0 : parseInt(inp.value, 10));
    const clues = grid.filter(v => v !== 0).length;
    if (clues < 17) { toast('数字が少なすぎます (17個以上必要です)'); return; }
    if (S.findConflicts(grid).length > 0) { toast('同じ行・列・ブロックに重複があります。赤枠を修正してください'); markReviewConflicts(grid); return; }
    const nsol = S.countSolutions(grid, 2, null);
    if (nsol === 0) { toast('この問題には解がありません。読み取りミスがないか確認してください'); return; }
    const solution = nsol === 1 ? S.solve(grid) : null;
    if (nsol > 1) toast('解が複数ある問題です。ヒントは手筋ベースのみ利用できます');
    closeModal('#importModal');
    startGame(grid, solution, 'imported', '取込問題');
    toast('取り込んだ問題を開始しました。ヒント機能も使えます');
  });

  function markReviewConflicts(grid) {
    const bad = new Set(S.findConflicts(grid));
    Array.from($('#reviewGrid').children).forEach((inp, i) =>
      inp.classList.toggle('conflict', bad.has(i)));
  }

  $('#backToCornersBtn').addEventListener('click', () => {
    $('#importStep1').style.display = '';
    $('#importStep2').style.display = 'none';
    requestAnimationFrame(drawImportCanvas);
  });

  /* ---------- PDF ---------- */
  $('#pdfBtn').addEventListener('click', () => {
    if (!state.current) return;
    openModal('#pdfModal');
  });
  $('#pdfExportBtn').addEventListener('click', () => {
    const includeProgress = $('#pdfProgress').checked;
    const includeSolution = $('#pdfSolution').checked;
    closeModal('#pdfModal');
    const ok = window.SudokuPDF.exportPdf({
      puzzle: state.puzzle,
      current: state.current,
      solution: includeSolution ? state.solution : null,
      levelEn: LEVEL_EN[state.levelKey] || '-',
      userName: lsGet(LS.NAME) || '',
      includeProgress,
    });
    if (!ok) {
      toast('PDFライブラリが使えないため、印刷ダイアログからPDF保存してください。' +
        '印刷されるのは画面の盤面だけで、解答ページは付きません', 5000);
    }
  });

  /* ---------- イベント結線 ---------- */
  $$('#numpad button[data-num]').forEach(b =>
    b.addEventListener('click', () => inputNumber(parseInt(b.dataset.num, 10))));
  $('#eraseBtn').addEventListener('click', eraseCell);
  $('#noteBtn').addEventListener('click', () => { state.noteMode = !state.noteMode; render(); });
  $('#undoBtn').addEventListener('click', undo);
  $('#hintBtn').addEventListener('click', () => showHint());
  $('#altHintBtn').addEventListener('click', () => showHint(state.hintIdx + 1));
  $('#applyHintBtn').addEventListener('click', applyHint);
  $('#checkBtn').addEventListener('click', checkMistakes);
  $('#cancelGenBtn').addEventListener('click', cancelGeneration);
  $('#newGameBtn').addEventListener('click', () => {
    newGame($('#levelSelect').value);
  });
  $('#winNewGameBtn').addEventListener('click', () => {
    closeModal('#winModal');
    newGame($('#levelSelect').value);
  });
  $$('.modal [data-close]').forEach(b =>
    b.addEventListener('click', () => { closeModal('#' + b.closest('.modal').id); clearHintHighlights(); }));
  window.addEventListener('resize', () => { if ($('#importModal').classList.contains('open')) drawImportCanvas(); });
  window.addEventListener('beforeunload', saveGame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopTimer(); saveGame(); }
    else if (state.current && !state.finished) startTimer();
  });

  /* ---------- 起動 ---------- */
  buildBoard();
  initUser();
  const savedLevel = lsGet(LS.LEVEL);
  if (savedLevel && S.LEVELS[savedLevel]) $('#levelSelect').value = savedLevel;
  if (loadGame()) {
    startTimer();
    render();
    toast('前回の続きから再開しました');
  } else {
    newGame($('#levelSelect').value);
  }
})();
