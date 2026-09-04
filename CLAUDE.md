# CLAUDE.md — 3D 象棋對局場(xiangqi-arena)

★ **先讀 `README.md`**(這個 repo 為什麼存在、功能、部署雷、11 個踩過的坑)。這份只放 AI 接手要守的鐵則與現況。

## 現況(**2026-09-04,agape250 機**)

- 🧠 **AI 引擎重寫 + 📅 題庫全換「N 手連將殺」+ 規則層補「不得自將」(0904)**。細節見 `roadmap.md` 已完成段與 `js/ai.js` 檔頭註解。
  ⚠ 題庫由 scripts 生成 + 求解器窮舉驗證,**不要手改題目座標**;改了必跑 `npm test`。
  ⚠ 隨機只能給初級檔:中級以上一旦加「機率亂走」,實測一盤就丟掉一台車等級的分數。

- ✅ v1 重建版(0901~0902,`828a06e` / `f1ab8e7`):開局譜 / 盤面快照存讀檔 / 2D-3D / 長將 / 悔棋 / 💡 提示 /
  📅 每日殘局 5 題 / 統計打點 / `npm run stage` 乾淨部署包。
- ✅ v2 ⛶ 全螢幕棋盤(0902,`f06ddac`):使用者「要能全螢幕,因下棋的畫面太小」。
- 線上 https://incandescent-stroopwafel-31007a.pages.dev = 最新(SW `xiangqi-3d-shell-v5`)。
- 測試:`npm test` 45+251/0;`npm run check` 40/0(本機與線上都跑過)。
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
