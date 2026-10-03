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

> 注: B-001 は A-001 と同一 (A が修正中)。B は index.html を触りません。

### B-002 [severity: high] [owner: A] src/main.js:369 (settings toggle 'sound')
現象: 設定の「サウンド」を切り替えると `TypeError: audio.mute is not a function`。さらに SETTINGS.sound=false で保存しても起動時に常に音が鳴る。
原因: makeAudio() の api に mute() が無い。boot/start 時に SETTINGS.sound を参照していない。
修正案: api.mute(m){ if(master) master.gain.value = m?0:0.9; muted=m }、start() の最後で api.mute(!SETTINGS.sound)。
状態: open

### B-003 [severity: med] [owner: C (reflection.js) / A (main.js)] src/world/reflection.js:21
現象: 雨を OFF に保存して再読み込みすると、雨粒は消えるが路面の雨紋 (ripples) は出続ける。
原因: refl.uniforms.uRain の初期値が固定 1。sky.js 側は SETTINGS.rain を見ているのに reflection は見ていない。
修正案: `uRain: { value: SETTINGS.rain ? 1 : 0 }` (import SETTINGS)。
状態: open

### B-004 [severity: low] [owner: A (settings.js) / 各自] src/settings.js
現象: プリセットの `steam`, `screensPerFrame`, `anisotropy` がどこからも参照されない → 超軽量でも異方性 8〜16 のまま (kiosks.js:214, props.js:62, sky.js:111 がハードコード 8)。
修正案: 各所で `Q.anisotropy` を使う (B は props.js / materials.js / textures.js 側を対応します)。screensPerFrame は D (screens.js)、steam は該当者。
状態: fixing(B: 自分のファイル分)

### B-004 状態更新: fixed(B) — materials.js / textures.js toTex / props.js leafTexture が Q.anisotropy を上限に使用 (kiosks.js:214 は D、sky.js:111 は C のファイル: 各自対応お願いします)

### B-005 [severity: med] [owner: B] src/world/props.js makeTree() leaf cards
現象: 街路樹の樹冠が白い砂嵐状のノイズに見える (特に数 m〜20 m, fullcanvas 時に顕著)。フレーム毎にちらつく。
原因(調査中): alphaTest 0.45 + alphaToCoverage + 512px 葉アトラスの mipmap で、遠目のテクセルが α 境界で点状に抜ける。
  alphaToCoverage=false / mipmap 無効化では完全には消えない → 葉色 (0xb4c8b8 × instanceColor L 0.5±0.11) が明るすぎ + 月光の key light の鏡面が乗っている可能性。
修正案: 葉アトラスのα を dilate (縁を塗り足し) + 遠距離は α をソフト化 (alphaHash)、color を暗めに、roughness 1。
状態: open (B 継続)

### B-006 [severity: med] [owner: B] src/world/city.js buildRow 低層ファサード
現象: 歩道からカメラ近傍 (10 m 以内) の建物壁面 (1〜3 階) が真っ黒の板に見え、細部が無い。
原因: 1 階上 (GF..) の facade は窓 emissive のみで、近距離では窓セルが 3.2 m 幅に対し画面を覆い、消灯セル (#050609) が支配的。環境光が届かない。
修正案: 低層 2 フロアに点灯率を上げた専用 emissive (店舗 2F の看板窓/テナント文字)、袖看板/室外機/雨樋を低層に集中配置。
状態: open (B 継続)
