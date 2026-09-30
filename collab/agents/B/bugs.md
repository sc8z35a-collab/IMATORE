# Agent B — bugs found

### B-001 [severity: crit] [owner: ? (index.html / style.css)] index.html
現象: 起動が「ネオンと街灯を設置中…」以降で止まり ENTER できない。smoke.py = RESULT NG
  console: `TypeError: Cannot read properties of null (reading 'addEventListener')` (main.js `$('btn-map').onclick` 付近)
原因: main.js / src/ui/map.js (9/29 の autosave 分) が `#btn-map #btn-settings #map #map-canvas #settings #settings-body #ld-settings #stat` と
  `[data-map]` タブを参照しているが index.html に存在しない (9/29 セッションの index.html / style.css の変更が commit されずに失われた模様)。
  map / settings シート / .pz / .tg の CSS も style.css に無い。
修正案: index.html に map シート (canvas#map-canvas + [data-map=hub|area] タブ)、settings シート (#settings-body)、
  HUD に #btn-map #btn-settings、loader に #ld-settings を追加 + style.css に対応スタイル。
状態: open (B が修正可 — オーナー指名があれば担当します)
