/* 画像取込: 写真から数独の盤面を読み取る。
 * 流れ: 画像読込 → 四隅をドラッグで合わせる → 射影変換で正方形に補正
 *       → 81マスに分割 → 空マス判定(インク量) → Tesseract.js で数字認識
 * 依存: Tesseract.js (CDN, 遅延ロード)
 */
(function (global) {
  'use strict';

  const WARP = 630;          // 補正後の一辺 px (70px/マス)
  const MAX_SRC_EDGE = 2000; // 射影変換の入力に使う元画像の長辺上限 px

  /* ---------- 射影変換 (単位正方形 → 四角形) Heckbert の閉形式 ---------- */
  function squareToQuad(p) {
    // p = [tl, tr, br, bl] 各 {x, y}
    const [p0, p1, p2, p3] = p;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    let g = 0, h = 0;
    if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
      const dx1 = p1.x - p2.x, dy1 = p1.y - p2.y;
      const dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
      const den = dx1 * dy2 - dx2 * dy1;
      /* den ≒ 0 = 3点が一直線・2点が重なる退化四角形。そのまま割ると g,h が
       * Infinity/NaN になり、以後の warp 結果が全滅する(エラーは出ず、真っ白か
       * 崩れた画像で認識0個になる)。ここは g=h=0 のアフィン近似へ落とす。 */
      if (Math.abs(den) > 1e-9) {
        g = (sx * dy2 - dx2 * sy) / den;
        h = (dx1 * sy - sx * dy1) / den;
      }
    }
    const a = p1.x - p0.x + g * p1.x;
    const b = p3.x - p0.x + h * p3.x;
    const c = p0.x;
    const d = p1.y - p0.y + g * p1.y;
    const e = p3.y - p0.y + h * p3.y;
    const f = p0.y;
    return (u, v) => {
      const w = g * u + h * v + 1;
      /* 退化した四角形では単位正方形の内側に w = 0 (無限遠に飛ぶ点) が現れる。
       * そのまま割ると Infinity/NaN が漏れ出て、警告なしに描画・認識が壊れる。
       * ここでは 0 を避けて「非常に遠い有限の点」に落とす。warpImage 側の
       * 範囲チェックで盤外と判定され白く塗られるので、被害はそのマスに留まる。 */
      const ww = Math.abs(w) < 1e-9 ? (w < 0 ? -1e-9 : 1e-9) : w;
      return { x: (a * u + b * v + c) / ww, y: (d * u + e * v + f) / ww };
    };
  }

  /* 四隅 [tl, tr, br, bl] が「つぶれていない」凸四角形かを判定する。
   * 3点が一直線・2点が重なる・裏返るような四隅を許すと射影変換が発散するため、
   * ドラッグ側でこの検査を通らない移動は受け付けない。
   * minEdge は退化とみなす辺の長さの下限 (元画像の座標系)。 */
  function isConvexQuad(pts, minEdge) {
    if (!Array.isArray(pts) || pts.length !== 4) return false;
    const minLen = minEdge > 0 ? minEdge : 1;
    const minCross = minLen * minLen * 0.05; // ほぼ一直線な並びを弾く
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const a = pts[k], b = pts[(k + 1) % 4], c = pts[(k + 2) % 4];
      if (!a || !b || !c) return false;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
      const ux = b.x - a.x, uy = b.y - a.y;
      if (Math.sqrt(ux * ux + uy * uy) < minLen) return false; // 辺が短すぎる / 2点が重なる
      const cross = ux * (c.y - b.y) - uy * (c.x - b.x);
      if (!Number.isFinite(cross) || Math.abs(cross) < minCross) return false; // 3点が一直線
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false; // 凹み / 自己交差
    }
    return true;
  }

  /* 四隅 corners に囲まれた領域を WARP×WARP に補正して canvas を返す。
   * corners は元画像の座標系で受け取る (呼び出し側は原寸のまま渡してよい)。 */
  function warpImage(img, corners) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    /* 原寸のまま getImageData すると、スマホ写真 (4032x3024 = 12MP) で約 48MB、
     * 48MP 級では 200MB 近い RGBA バッファになる。iOS Safari では canvas の
     * 上限を超えて描画が黙って失敗し、真っ白な盤面を認識して「数字0個」になる。
     * 出力は WARP×WARP しか使わないので、長辺を MAX_SRC_EDGE まで縮めてから扱う。 */
    const k = Math.min(1, MAX_SRC_EDGE / Math.max(iw, ih, 1));
    const sw = Math.max(1, Math.round(iw * k));
    const sh = Math.max(1, Math.round(ih * k));

    const src = document.createElement('canvas');
    src.width = sw; src.height = sh;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, sw, sh);
    const srcData = sctx.getImageData(0, 0, sw, sh);

    const dst = document.createElement('canvas');
    dst.width = WARP; dst.height = WARP;
    // extractDigit が 81 回 getImageData するので読み出し前提のコンテキストにする
    const dctx = dst.getContext('2d', { willReadFrequently: true });
    const dstData = dctx.createImageData(WARP, WARP);
    // 四隅も同じ倍率へ寄せる (corners は元画像の座標系のまま渡ってくる)
    const map = squareToQuad(k === 1 ? corners : corners.map(p => ({ x: p.x * k, y: p.y * k })));

    for (let y = 0; y < WARP; y++) {
      for (let x = 0; x < WARP; x++) {
        const s = map(x / WARP, y / WARP);
        const sx = Math.round(s.x), sy = Math.round(s.y);
        const di = (y * WARP + x) * 4;
        if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
          const si = (sy * sw + sx) * 4;
          dstData.data[di] = srcData.data[si];
          dstData.data[di + 1] = srcData.data[si + 1];
          dstData.data[di + 2] = srcData.data[si + 2];
          dstData.data[di + 3] = 255;
        } else {
          dstData.data[di] = dstData.data[di + 1] = dstData.data[di + 2] = dstData.data[di + 3] = 255;
        }
      }
    }
    dctx.putImageData(dstData, 0, 0);
    return dst;
  }

  /* ---------- 2値化 (Otsu) ---------- */
  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (const g of gray) hist[g]++;
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, maxVar = 0, thresh = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) { maxVar = v; thresh = t; }
    }
    return thresh;
  }

  /* 1マス分の画像から数字部分を抽出。空マスなら null、
   * 数字がありそうなら認識用の 64x64 canvas を返す */
  function extractDigit(warped, row, col) {
    const cell = WARP / 9;
    const margin = cell * 0.12; // 枠線を避ける
    const sx = col * cell + margin, sy = row * cell + margin;
    const size = cell - margin * 2;
    const ctx = warped.getContext('2d');
    const data = ctx.getImageData(sx, sy, size, size);
    const w = data.width, h = data.height;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = Math.round(
        0.299 * data.data[i * 4] + 0.587 * data.data[i * 4 + 1] + 0.114 * data.data[i * 4 + 2]);
    }
    const th = otsuThreshold(gray);
    // 中央寄りの領域でインク(暗)ピクセルを数え、境界ノイズを無視する
    let ink = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (gray[y * w + x] < th * 0.9) {
          const border = x < w * 0.06 || x > w * 0.94 || y < h * 0.06 || y > h * 0.94;
          if (border) continue;
          ink++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (ink < w * h * 0.015) return null; // 空マス
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < 3 || bh < 5) return null; // ゴミ

    // 数字を白黒2値で 64x64 の中央に描く (Tesseract が読みやすい形)
    const out = document.createElement('canvas');
    out.width = 64; out.height = 64;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, 64, 64);
    const scale = Math.min(40 / bw, 40 / bh);
    const dw = bw * scale, dh = bh * scale;
    const ox = (64 - dw) / 2, oy = (64 - dh) / 2;
    const bin = octx.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const v = gray[(y + minY) * w + (x + minX)] < th ? 0 : 255;
        const j = (y * bw + x) * 4;
        bin.data[j] = bin.data[j + 1] = bin.data[j + 2] = v;
        bin.data[j + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = bw; tmp.height = bh;
    tmp.getContext('2d').putImageData(bin, 0, 0);
    octx.imageSmoothingEnabled = true;
    octx.drawImage(tmp, ox, oy, dw, dh);
    return out;
  }

  /* ---------- Tesseract ---------- */
  const OCR_WORKERS = 3; // 並列数。増やすほど初期化コストとメモリが増える
  let schedulerPromise = null;

  function makeWorker() {
    return Tesseract.createWorker('eng').then(async (w) => {
      await w.setParameters({
        tessedit_char_whitelist: '123456789',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR,
      });
      return w;
    });
  }

  /* worker 複数個を束ねた scheduler を返す。
   * 81マスを1個ずつ直列に recognize すると数十秒かかるため並列化する。 */
  function getScheduler() {
    if (!schedulerPromise) {
      if (typeof Tesseract === 'undefined') {
        return Promise.reject(new Error('Tesseract.js が読み込めませんでした。ネット接続を確認してください。'));
      }
      const scheduler = Tesseract.createScheduler();
      const jobs = [];
      for (let k = 0; k < OCR_WORKERS; k++) {
        jobs.push(makeWorker().then(w => scheduler.addWorker(w)));
      }
      schedulerPromise = Promise.all(jobs).then(() => scheduler, (err) => {
        // 途中まで作れた worker を取り残さない
        try { scheduler.terminate(); } catch (_) { /* noop */ }
        throw err;
      }).catch((err) => {
        // 失敗した Promise をキャッシュしたままだと、ネット復帰後も永久に失敗し続ける
        schedulerPromise = null;
        throw err;
      });
    }
    return schedulerPromise;
  }

  /* 認識が終わったら worker を解放する。
   * 1回の取込で用が済むのに WASM + 学習データが常駐し続ける方が高くつくので、
   * 再取込時は作り直す。 */
  function releaseScheduler() {
    const p = schedulerPromise;
    schedulerPromise = null;
    if (!p) return Promise.resolve();
    return p.then(s => s.terminate()).catch(() => { /* 解放時のエラーは握りつぶす */ });
  }

  /* 盤面全体を認識。onProgress(done, total) を随時呼ぶ。
   * 戻り値: { grid: 長さ81 (0=空), uncertain: [index...] } */
  async function recognizeGrid(img, corners, onProgress) {
    const warped = warpImage(img, corners);
    const cells = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        cells.push(extractDigit(warped, r, c));
      }
    }
    const total = cells.filter(Boolean).length;
    const grid = new Array(81).fill(0);
    const uncertain = [];
    if (total === 0) return { grid, uncertain, warped };
    const targets = [];
    for (let i = 0; i < 81; i++) if (cells[i]) targets.push(i);

    const scheduler = await getScheduler();
    try {
      let done = 0;
      // 結果は targets の順(索引の昇順)で揃うので uncertain も昇順のまま
      const results = await Promise.all(targets.map(i =>
        scheduler.addJob('recognize', cells[i]).then((res) => {
          done++;
          if (onProgress) onProgress(done, total);
          return res;
        })));
      results.forEach((res, k) => {
        const i = targets[k];
        const data = (res && res.data) || {};
        const txt = (data.text || '').replace(/[^1-9]/g, '');
        const conf = data.confidence || 0;
        if (txt.length >= 1) {
          grid[i] = parseInt(txt[0], 10);
          if (conf < 60) uncertain.push(i);
        } else {
          uncertain.push(i); // 何かあるのに読めない
        }
      });
    } finally {
      await releaseScheduler();
    }
    return { grid, uncertain, warped };
  }

  const api = { warpImage, recognizeGrid, squareToQuad, isConvexQuad, WARP, MAX_SRC_EDGE };

  // 画像処理はブラウザ専用だが、幾何まわり (squareToQuad / isConvexQuad) は
  // 純関数なので Node からも require して単体テストできるようにしておく
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SudokuOCR = api;
})(typeof window !== 'undefined' ? window : globalThis);
