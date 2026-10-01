# Agent C — bugs found

### C-001 [severity: med] [owner: C] src/world/reflection.js:21 (= B-003)
現象: 雨 OFF を保存して再読み込みしても路面の雨紋が出続ける。
原因: `uRain` 初期値が固定 1 (SETTINGS.rain を見ていない)。
修正: `uRain: { value: SETTINGS.rain ? 1 : 0 }`。状態: fixed(C)

### C-002 [severity: med] [owner: C] src/world/landscape.js buildMountains (Fuji)
現象: 富士山の円錐が裏返しで描画される (法線が内向き、正面が内側)。月光の当たる側が逆、シルエットは裏面の奥側の面。
原因: LatheGeometry にプロファイルを `prof.reverse()` (上→下) で渡している。three の Lathe は下→上前提 → 法線/巻き順が内向き (node で検証: normals in=225/out=0)。
修正: reverse をやめ、頂点(0,H) を末尾に追加する順序に。状態: fixed(C)

### C-003 [severity: low] [owner: C] src/world/landscape.js buildPort
現象: コンテナ (InstancedMesh) が全部同じ灰色。pal / Color を作っているが未使用 (コメントで諦めている)。
原因: hazeLit は instanceColor を読まない。
修正: hazeLit に USE_INSTANCING_COLOR 対応を追加し setColorAt。状態: fixed(C)

### C-004 [severity: low] [owner: C] src/world/landscape.js buildPort
現象: 「a lit cruise ship / yakatabune near the bridge」はコメントのみで未実装。船は静止 (コメントは sailing slowly)。
修正: 屋形船 + 航行する船 + 航跡を追加 (C タスク)。状態: fixed(C)

### C-005 [severity: low] [owner: C] src/world/engine.js adapt()
現象: fpsCap=30 (超軽量) で main.js が 30fps に間引くと dt は ~33ms。adapt の閾値 target=30 → fps<18.9 で下げ / >28.5 で上げ。上限 30 に張り付くので 28.5 を超えてすぐ上げ→重くなって下げを繰り返す (DPR ピンポン)。
修正: 上げはより厳しく (>0.97*target かつ 2 回連続)、下げた直後のクールダウンを追加。状態: fixed(C)

### C-006 [severity: low] [owner: C] src/world/sky.js
現象: 雲が 2 層の fbm だけで、遠雷/月暈なし。shadow camera が毎フレーム追従するが far=400 に対し key.position=150 → ok。問題は moon sprite が雲の手前に常に加算描画され、厚い雲の後ろでも月コロナが見える。
修正: 月コロナを dome シェーダ内に統合 (雲被覆 cov で減衰)。状態: fixed(C)

### C-007 [severity: high] [owner: C] src/world/platform.js (prow beacon mast)
現象: スカイツリー (avenue 1 の眺望ランドマーク) がテラスから一切見えない。描画はされている (遠景ビルを消しても見えない)。
原因: 各テラス先端の照明マスト (半径 0.09m の chrome 円柱) が **アベニュー軸上 EDGE-1.2** に立っており、テラス中心の視点 → ランドマークの視線とぴったり重なる。
  幅 ~3px のスカイツリーがマストの陰に完全に隠れていた (pix probe でマスト非表示時のみ色が変わることで特定)。
修正: マストを軸から ±1.5m の 2 本に分割 (眺望を左右から額縁のように挟む)。fixed(C)

### C-008 [severity: med] [owner: C] src/world/landscape.js buildFarCity
現象: 富士山 (4.7km, 仰角 ~10°) / 東京タワー / スカイツリー の下半分が遠景ビルに隠れ、富士は完全に見えなかった。
修正: 眺望保全 (view corridor) — 各ランドマークへの視線コーン内の遠景ビル高さを視線の下に制限 (vistaCap)。fixed(C)

### C-009 [severity: low] [owner: C] src/world/landscape.js skytree shader
現象: スカイツリーの発光が ~0.18 で、haze に飲まれて灰色の棒に見える。
修正: 発光 + 内照 flood を強化し、ランドマーク発光は haze を 45% だけ適用。fixed(C)
