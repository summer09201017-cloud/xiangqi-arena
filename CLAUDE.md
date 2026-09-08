# CLAUDE.md — 3D 象棋對局場(xiangqi-arena)

★ **先讀 `README.md`**(這個 repo 為什麼存在、功能、部署雷、11 個踩過的坑)。這份只放 AI 接手要守的鐵則與現況。

## 現況(**2026-09-08,agape250 機**)

- ⛶💡 **真的全螢幕 + 提示先算「幾手必勝」(0908,使用者實機退件兩件)**:
  ① 退件原話「手機上的全螢幕,不是真的全螢幕,還能看到一半的選單」。病根:v8 的全螢幕是**縱向排版**
     (狀態列→提示行→每日行→棋盤 flex:1),直向 390×844 時七顆工具鈕折成三行,選單吃掉快一半的高度。
     (橫向有 `@media(max-height:500px)` 壓縮過,**直向沒有** —— 而使用者就是直向拿手機。)
     修法:`.canvas-shell` absolute inset:0 吃滿面板,工具列/狀態文字/每日行改**半透明浮層**
     (`.status-row` 當容器 + `pointer-events:none` 讓點擊穿透);畫布角落那顆 ⛶ 在全螢幕藏掉;
     工具列標籤改短(仍留看得懂的詞,不做 tooltip-only);難度下拉夾 `max-width`
     (它會照最寬的「Lv.1 初級(隨機/淺層)」自己撐開,360px 上獨佔一整行)。
     `renderer.fitCamera()`:畫布越瘦高就把相機壓得越接近正上方(`aspect<0.8` 起,≥0.8 完全照舊)——
     瘦高畫布是「寬先滿」、斜看又把投影壓扁,原本棋盤只用掉 36% 的高度。
     實測:畫布 370×668 → **390×844(整個視窗)**、選單浮層 98px = 視窗高 **12%**;
     browser-check 新增五條**直向**斷言(舊的全螢幕那幾條跑 1366×900 寬扁視窗,抓不到這個病)。
  ② 退件原話「我按照 AI 提示去走,結果車九被將吃了,AI 提示太弱」。
     病根**不是搜得不夠深**,是提示不知道自己在解殘局:殘局的勝利條件是「將死」,
     提示借的卻是對局引擎(子力 + PST 位置分)⇒ 在殘局裡追求「位置好看」。
     重現(18 題 × 4 局、紅方全程照提示走、黑方 hard):舊版 1400ms 桌機 88% 在標示手數內解掉、跳針 1/72;
     舊版 300ms(≈ 手機那個速度)掉到 81%、跳針 5/72 —— 有一題提示讓車在 (8,7)/(9,7) 之間
     來回跳針 15 手都不收(正解 4 手殺)。這也解釋了退件截圖:mateIn 3 的題「已走 7 步」還在走。
     修法(`js/ai.js`,與 `3D-Xiangqi` 逐字相同):
       · `_mateAttack` / `_mateDefend` / `findForcedMate`:連將殺(每手將軍、分支極小)n≤4,
         再一般必勝殺 n≤2;算不出回 `null` —— **「算不出」不等於「沒有」,文案不可混講**。
       · `hintMove()`:提示的**唯一入口**(app 不要再直接叫 `calculateBestMove`)。
         殘局搜更深;`rootFilter` 讓 app 傳「UI 真的允許這一手嗎」進來(長將被擋的棋不推薦)。
       · `LEVELS.hint.minDepth = 3`:原本只保證第 1 層跑完,而 1 層 + 逾時的 quiescence 連吃子鏈都不算
         ⇒ **提示品質跟著裝置速度變**(慢手機只看一步)。這幾層無論多慢都跑完。
       · 🛡 掉子關:交出去前用純子力把吃子鏈算到底,白丟半個卒以上就換次好的安全手;殺棋放行(棄子連殺是好棋)。
       · 文案三態(誠實鐵則):「這是 N 手必勝的第一手」/「這顆會被吃掉,是故意的——棄子換將位」
         /「這個局面已經算不出必勝殺法(可能走偏了)」。★ 中間那句正是退件那一句的答案:
         使用者不是不能接受棄子,他是**不知道那是故意的**。
     實測:標示手數內解掉 88% → **100%**(1400ms)、81% → **99%**(300ms);跳針 1/72 → **0/72**、5/72 → **1/72**。

- 🎯 **💡 提示加「多賺半個卒才建議吃子」門檻(0907)**:四站統一的規矩(西洋棋 ×2、中國象棋、暗棋);
  `LEVELS.hint.tradeMargin = 50`、`_hintRoot()` 兩段式根層、`_captureGain()` 純子力交換試算。AI 對手三檔不受影響。
  引擎與姊妹站 `3D-Xiangqi` 的 `js/ai.js` **逐字相同**(改一邊要同步另一邊)。
  ★ 同一輪順手修好「提示每局只搜到 depth 1」的真 bug(「算到殺棋就收工」漏了有限數檢查)⇒ 現在穩定 depth 4~6。
  測試:`npm test` = rules 45/0 + daily 251/0 + vertag 9/9 + hint 6/0。

- 🧠 **AI 引擎重寫 + 📅 題庫全換「N 手連將殺」+ 規則層補「不得自將」(0904)**。細節見 `roadmap.md` 已完成段與 `js/ai.js` 檔頭註解。
  ⚠ 題庫由 scripts 生成 + 求解器窮舉驗證,**不要手改題目座標**;改了必跑 `npm test`。
  ⚠ 隨機只能給初級檔:中級以上一旦加「機率亂走」,實測一盤就丟掉一台車等級的分數。

- ✅ v1 重建版(0901~0902,`828a06e` / `f1ab8e7`):開局譜 / 盤面快照存讀檔 / 2D-3D / 長將 / 悔棋 / 💡 提示 /
  📅 每日殘局 5 題 / 統計打點 / `npm run stage` 乾淨部署包。
- ✅ v2 ⛶ 全螢幕棋盤(0902,`f06ddac`):使用者「要能全螢幕,因下棋的畫面太小」。
- 線上 https://incandescent-stroopwafel-31007a.pages.dev = 最新(**SW `xiangqi-3d-shell-v10`、verTag v10**)。
- 測試:`npm test` = **rules 45/0 + daily 251/0 + vertag 9/9 + hint 6/0**;`npm run check` **45/0**(本機與線上都跑過)。
- 待做見 `roadmap.md`;給另一台機的在 `讀我-HANDOFF.txt`。

## 一檔一責

README「檔案」段是正本。全螢幕這一版落在:`js/app.js`(`enterFullscreen` / `exitFullscreen` / `applyFullscreenClass`,
工具列鈕轉呼叫側欄原鈕)、`css/style.css`(`.is-fs` / `.pseudo-fs` / `.fs-toolbar` / `.fs-btn`)、
`index.html`(`.stage-panel` 內的 `#fsToolbar` / `#fsButton` / `#gameOverOverlay`)、`js/renderer.js`(ResizeObserver)。

## 鐵則(務必守)

- **部署兩步**:`npm run stage` → `npx wrangler pages deploy .deploy --project-name incandescent-stroopwafel-31007a --branch main`。
  **沒有 `--branch main` 只建 preview、正式網址不動**(本地分支叫 master,CF 的 production branch 叫 main)。
  `git push` 不會上線(直傳站)。
- **改任何檔 bump `sw.js` 的 `CACHE_NAME`**;新增要上線的檔要同時補 `scripts/stage.mjs` 的 `SHIP` 與 `sw.js` 的 `ASSETS_TO_CACHE`。
- **全螢幕**:對象是 `.stage-panel`(不是 canvas),結算蓋板必須留在面板內;不要改回 `:fullscreen` 選擇器;
  iPhone 假全螢幕路徑(`.pseudo-fs`)不能拆。正本在 skill `embed-fullscreen-fit` #8。
- **尺寸一律看容器**(`getBoundingClientRect` / ResizeObserver),不看 `window`(舊站爆板的病根)。
- **每日殘局**:不吃開局譜(`effectiveBook` 結構性強制)、不進存檔;題庫改了跑 `npm test`。
- **存檔鍵** `xiangqi-arena-save-v1`;舊站鍵 `xiangqi-3d-save-v3` 不讀不刪。
- 冒煙用**真點擊** `page.click`;無頭全螢幕原生/假兩路都要綠。

## 本機地雷

- 埠 8801(`npm run serve`);`.deploy/` 是 stage 產物、`.wrangler/` 是暫存,都不進 git。
- 姊妹站 `3D-Xiangqi`(3d-xiangqi.pages.dev)是另一個 repo、另一個 CF 專案;引擎與題庫從那邊移植,**修法要兩邊各自套**。
