# 数独 (Sudoku) Webアプリ

ブラウザだけで動く数独アプリ。サーバー・ビルド不要の静的サイトです。

## 公開URL

**https://kanekop.github.io/sudoku/** (GitHub Pages)

リポジトリ: https://github.com/kanekop/sudoku
`main` ブランチに push すると1〜2分で公開サイトに反映されます。

## ローカルでの開発・確認

```sh
cd ~/Projects/Apps/sudoku
python3 -m http.server 8642
# ブラウザで http://localhost:8642 を開く
```

※ `file://` で直接開くのではなくローカルサーバー経由を推奨。
　 OCR用のCDNライブラリ読込に加え、盤面生成の Web Worker が `file://` では起動できないため
　 (起動できない場合は自動でメインスレッド生成にフォールバックしますが、生成中UIが固まります)。

## テスト

依存パッケージなし。Node の標準テストランナーだけで動きます。

```sh
npm test          # = node --test "tests/**/*.test.js"
```

`main` への push と Pull Request では GitHub Actions (`.github/workflows/test.yml`) が
同じコマンドを実行します。

## キャッシュについて

`index.html` からのアセット参照には版番号を付けています (`js/app.js?v=2` など)。
中身を変えて公開する時は、`index.html` の `?v=` と、`js/app.js` 内の Worker 生成、
`js/generator-worker.js` の `importScripts` の `?v=` を同じ数字に上げてください
(ビルド不要という設計を守るため手動更新)。

## 機能

| 機能 | 説明 |
|---|---|
| レベル選択 | 入門・初級・中級・上級・難問・鬼の6段階。人間の手筋で解けるかを解析して難易度を保証。「鬼」は1マスも削れない極小盤面まで掘り込み、手筋だけでは解けず探索の試行錯誤量が最大のものを選抜 |
| 次の一手 | 💡ボタンで次の一手を提示。手筋名(Naked Single, 隠れたシングル, 予約, ペア, X-Wing等)と日本語の理由付き。「別の手を見る」で代替手を順に提示 |
| 画像取込 | 📷で紙の問題の写真を選択 → 青い4点を盤面の四隅に合わせる → OCR(Tesseract.js)で数字認識 → 確認・修正して開始。取込後もヒント機能が使える |
| レスポンシブ | スマホは縦積み・PCは横並びレイアウト。タップ/キーボード両対応 |
| PDF出力 | 問題+解答ページをA4 PDFでダウンロード(jsPDF)。記入途中の状態も出力可 |
| ユーザー記憶 | 名前・進行中のゲーム・選択レベルを localStorage に保存(ブラウザごと)。途中で閉じても再開できる |

その他: メモ(鉛筆書き)、Undo、間違いチェック、タイマー、数字ごとの残数表示、クリア判定。

## ファイル構成

```
index.html               画面構成・モーダル
css/style.css            レスポンシブ・印刷用スタイル
js/sudoku.js             盤面生成・解答・一意解チェック・難易度判定
js/hints.js              手筋エンジン: 次の一手と理由の生成
js/generator-worker.js   盤面生成を別スレッドで回す Web Worker
js/ocr.js                画像取込: 射影変換・マス分割・数字認識
js/pdf.js                PDF出力 (jsPDF / 印刷フォールバック)
js/app.js                UI・状態管理・localStorage保存
tests/                   node:test による単体テスト (sudoku / hints / ocr)
```

`js/sudoku.js` `js/hints.js` `js/ocr.js` はブラウザと Node の両方から読めます
(Node では `module.exports`、ブラウザでは `window.Sudoku` などに生えます)。

外部依存は CDN の Tesseract.js(OCR)と jsPDF(PDF)のみ。どちらも該当機能を使う時だけ必要。

## キーボード操作 (PC)

- `1`〜`9`: 数字入力(同じ数字でトグル削除) / `Backspace`: 消す
- 矢印キー: マス移動 / `N`: メモモード切替 / `Cmd+Z`: 元に戻す
