/* PDF出力: 現在の問題(1ページ目)と解答(2ページ目)を A4 PDF にする。
 * 依存: jsPDF (CDN)。読み込み失敗時は印刷ダイアログ(ブラウザのPDF保存)にフォールバック。
 */
(function (global) {
  'use strict';

  function drawGrid(doc, grid, givens, ox, oy, size, showUser) {
    const cell = size / 9;
    // マス目
    for (let k = 0; k <= 9; k++) {
      const lw = k % 3 === 0 ? 1.1 : 0.25;
      doc.setLineWidth(lw);
      doc.line(ox, oy + k * cell, ox + size, oy + k * cell);
      doc.line(ox + k * cell, oy, ox + k * cell, oy + size);
    }
    // 数字
    doc.setFont('helvetica', 'normal');
    for (let i = 0; i < 81; i++) {
      const v = grid[i];
      if (!v) continue;
      const isGiven = givens[i] !== 0;
      if (!isGiven && !showUser) continue;
      const r = Math.floor(i / 9), c = i % 9;
      doc.setFont('helvetica', isGiven ? 'bold' : 'normal');
      doc.setTextColor(isGiven ? 20 : 60, isGiven ? 20 : 90, isGiven ? 20 : 200);
      doc.setFontSize(cell * 1.9);
      doc.text(String(v), ox + c * cell + cell / 2, oy + r * cell + cell / 2, {
        align: 'center', baseline: 'middle',
      });
    }
    doc.setTextColor(0, 0, 0);
  }

  /* opts: {
   *   puzzle,           // 出題時の盤面 (太字で出す givens の判定にも使う)
   *   current,          // 現在の記入内容 (includeProgress のときだけ描く)
   *   solution,         // 解答。null なら解答ページを付けない
   *   levelEn,          // レベル名の英語表記 (jsPDF 標準フォントは日本語を描けない)
   *   userName,         // ASCII のときだけ Player: として載せる
   *   includeProgress,  // true なら1ページ目に current を描く
   * } */
  function exportPdf(opts) {
    const JsPDF = global.jspdf && global.jspdf.jsPDF;
    if (!JsPDF) { fallbackPrint(); return false; }

    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210;
    const size = 150;
    const ox = (pageW - size) / 2;
    const dateStr = new Date().toLocaleDateString('ja-JP');

    // 1ページ目: 問題 (日本語はjsPDF標準フォントで出せないため英語表記)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('SUDOKU', pageW / 2, 25, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    // jsPDFの標準フォントは日本語を描画できないため、ASCII名のみ載せる
    const asciiName = opts.userName && /^[\x20-\x7E]+$/.test(opts.userName) ? opts.userName : '';
    const sub = `Level: ${opts.levelEn || '-'}    Date: ${dateStr}` +
      (asciiName ? `    Player: ${asciiName}` : '');
    doc.text(sub, pageW / 2, 33, { align: 'center' });
    drawGrid(doc, opts.includeProgress ? opts.current : opts.puzzle,
      opts.puzzle, ox, 45, size, opts.includeProgress);

    // 2ページ目: 解答
    if (opts.solution) {
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text('SUDOKU - Solution', pageW / 2, 25, { align: 'center' });
      drawGrid(doc, opts.solution, opts.puzzle, ox, 45, size, true);
    }

    doc.save(`sudoku_${dateStr.replace(/\//g, '-')}.pdf`);
    return true;
  }

  /* jsPDF が読み込めなかったときの逃げ道。
   * 画面に見えている盤面を印刷するだけなので、「解答ページを付ける」
   * 「記入内容も含める」の指定は反映されない (呼び出し側でその旨を伝えること)。 */
  function fallbackPrint() {
    window.print();
  }

  global.SudokuPDF = { exportPdf };
})(window);
