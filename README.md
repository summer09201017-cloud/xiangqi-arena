# 3D 象棋對局場(xiangqi-arena)

Three.js 中國象棋 PWA。**線上正式站:<https://incandescent-stroopwafel-31007a.pages.dev>**

## ★ 這個 repo 為什麼存在(先讀這段)

這一站以前是**沒有源碼的**。它 2026-08-17 從 Netlify 搬到 Cloudflare Pages 時走的是「鏡像法」
(從活站抓檔、原樣傳上 CF),原始專案從此失蹤:四路都查過 —— 本機三個資料夾、GitHub 全部 repo、
線上沒有 sourcemap、全機 grep 站名零命中。

2026-09-01 使用者拍板**重建**(選項 B):新開這個 repo,部署覆蓋同一個 CF 專案
⇒ **網址不變、從此有源碼**。引擎與題庫移植自 `summer09201017-cloud/3D-Xiangqi`,
對局場專屬的四件(開局譜 / 存讀檔 / 2D-3D 視角 / 長將規則)是照舊站的行為**重寫**的。

施工單:`hfpc-claude-skills/references/象棋對局場-每日殘局移植規格-2026-09-01.md`

## 功能

| | |
|---|---|
| 對局 | 人 vs AI,三檔難度;玩家可選執紅(先手)或執黑 |
| 開局棋譜 | 全譜庫 / 中炮譜 / 飛相譜 / 起馬譜 / 仙人指路譜 / 不載入,AI 在**開局前 15 手**優先參考 |
| 💡 AI 提示 | 借同一支引擎從玩家這邊算一手,綠圈=要動的棋、綠環/綠點=要去的地方 |
| 📅 每日殘局 | 每天一組 **5 題**,全世界同一組同順序;每題分開記最少步數;只留 60 天 |
| 存讀檔 | **盤面快照**式(不是重播棋譜),鍵 `xiangqi-arena-save-v1` |
| 2D / 3D | 3D 可滑鼠自由轉;2D 是正上方視角,附左右轉 45° |
| 悔棋 | 退兩個半回合(你的 + AI 回的),連按可一直往前 |
| 規則 | 一般象棋走法 + **長將**:連續將軍且局面繞回來就擋 |

## 跑起來

```bash
npm install
npm test          # 引擎 45 項 + 題庫 129 項
npm run serve     # http://localhost:8801
npm run check     # 另一個視窗:真瀏覽器冒煙 31 項
```

線上驗收:`CHECK_URL=https://incandescent-stroopwafel-31007a.pages.dev npm run check`

## 部署(⚠ 這站的雷)

```bash
# ⚠ 一定要 --branch main,否則只建了 preview、正式網址一動也不動
npx wrangler pages deploy . --project-name incandescent-stroopwafel-31007a --branch main
```

- 專案**未連 git**,是**直傳站** ⇒ `git push` 不會上線,一定要跑上面那行。
- 改任何檔案都要 bump `sw.js` 的 `CACHE_NAME`(cache-first,不 bump 舊使用者永遠拿舊版)。
- 線上驗收**看內容不看狀態碼**。

## 🕳 建構期間真的踩過的坑

| # | 坑 | 怎麼發現的 / 怎麼防 |
|---|---|---|
| 1 | **棋子上的字轉了 90°** | 圓柱頂面 UV 配 `rotateX(π/2)`。象棋有一半的字(車/士/兵/王)接近對稱,轉了看不太出來 ⇒ 掃一眼會放它過關。**把「鏡像 × 0/90/180/270」八種並排渲染一次**就挑出唯一正解(`screenshots/uv-8.png`)。我先憑推理猜「左右鏡像」再猜「上下顛倒」,兩次都錯 —— UV 方向排列組合看一次比推理三輪快。 |
| 2 | **舊站棋盤爆板** | 舊站拿 `window.innerWidth/innerHeight` 當畫布尺寸,而畫布住在有側欄的版面裡 ⇒ 紅方底線整排被切在畫面外(實機截圖看得到)。**點擊座標同一個病根** ⇒ 每一次點擊都會落在錯的格子。這一版一律讀容器與 canvas 的 `getBoundingClientRect`。 |
| 3 | **提示的目標點被棋子蓋住** | 小綠點畫在 z=0.5、半徑比棋子小 ⇒ 目標上有敵子時整個被壓在底下。提示說「吃掉對方的馬」而馬上面什麼都沒有 = 使用者只會覺得提示在亂講。有子的格改畫**比棋子大的綠環** + `depthTest:false`。 |
| 4 | **長將規則第一版永遠擋不到** | 我寫成「同一步緊接著重複」—— 真實對局裡要重複同一步,中間一定得先把子走回去,那一步就把連續打斷了。測試當場抓出來(`blocked=null`)。正解是**連續將軍 + 局面重複**兩個條件都要成立。 |
| 5 | **只看「連續將軍幾次」會毀掉殘局** | 江湖殘局的正解常常就是一路將到底。只擋連續將軍的話那些題會變成死題。加上「局面重複」這個條件之後,16 題**開著規則實打**全部仍然解得動。 |
| 6 | **殘局不會自動避開開局譜** | 直覺是「殘局起手不是標準開局,譜自然對不上」——**錯的**:實測 16 題裡有 **7 題**的盤面剛好讓譜挑得出走法。⇒ `effectiveBook(selected, isDaily)` **結構性**強制成 `none`,不能指望盤面湊不上。 |
| 7 | **手抄的開局譜會自己把路堵死** | 「炮先跳馬再平中」⇒ 炮的路被自己的馬擋住。這種錯只有讓機器把每一條線**整條走一次**才看得到 ⇒ `test/rules.mjs` ③。 |
| 8 | **存檔格式** | 五款每日殘局全踩過:棋譜重播式存檔吃不下自訂起手局面,讀回來會**靜默重建成另一個局面**。這一版存盤面快照;而且每日殘局一律不進存檔。 |
| 9 | **舊存檔鍵不可沿用** | 舊站是另一支引擎(WXF 字串棋譜),`xiangqi-3d-save-v3` 格式對不上。沿用同一個鍵去讀,會拿到「欄位看得懂、盤面擺不出來」的資料 —— 比沒有存檔更糟。新鍵 `xiangqi-arena-save-v1`,舊鍵不動不刪。 |
| 10 | **棋盤掉到摺線下面** | `aspect-ratio: 9/10` 在 1400×900 算出 702px 高,加上標題列之後底線要捲動才看得到。改成 `height: clamp(320px, calc(100vh - 300px), 760px)` —— 相機是算出來的,畫布是寬是扁都裝得下。 |

## 檔案

```
index.html          對局場的殼
css/style.css       版面
js/pieces.js        走法規則(移植自 3D-Xiangqi)
js/gameLogic.js     盤面/走子/將軍 + 悔棋 + 長將規則(後兩者是本站新寫)
js/openings.js      五種開局譜 + effectiveBook(每日強制不吃譜)
js/puzzles.js       每日殘局題庫 16 題(移植)
js/save.js          盤面快照式存讀檔
js/ai.js            minimax + alpha-beta(移植)
js/renderer.js      Three.js 渲染 + 2D/3D + fitCamera(移植後大幅擴充)
js/app.js           全部接線
test/rules.mjs      引擎驗算 45 項(長將/悔棋/開局譜/每日旁路)
test/daily.mjs      題庫驗算 129 項(擺位/決定性/開著長將規則實打)
scripts/browser-check.mjs  真瀏覽器冒煙 31 項
```

## 帳本四處(改動這站時要一起更新)

1. 作品集 `hfpc-portfolio/data.js` 的 `3d-chess-arena`
2. `sites.json` ×2(skills repo 的 `references/machine-env-0714/gamefleet/` 與 `~/.claude/gamefleet/`)
3. 統計 Worker `hfpc-play-stats` 的 `NAMES`(顯示名)
4. skill `manual-deploy-map`(平台/專案名/部署目錄)
