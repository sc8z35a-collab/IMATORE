# IMATORE — 今トレ 3D Trend Hub

スマホ専用・一人称視点の3Dトレンドハブ (Three.js + Vite)。

- 本番: https://sc8z35a-collab.github.io/IMATORE/
- 開発: `npm install && npm run dev`
- ビルド: `npm run build` → `dist/`

## デプロイ (GitHub Pages)
`main` ブランチのリポジトリルートがそのまま配信されます。
`index.html` の importmap で three を CDN から読み込み、`src/` を未バンドルのまま実行できる構成
(静的アセットは `public/` を相対参照)。Vite ビルド (`dist/`) でも同じコードが動作します
(`vite.config.js` の `base: './'` でサブパス対応)。

`gh-pages` ブランチへビルド成果物を置く場合: `bash tools/deploy_pages.sh`

## QA
- `bash tools/setup_env.sh` — ヘッドレス環境の再構築
- `python3 tools/smoke.py URL` — 起動 / 404 / pageerror のスモークテスト
