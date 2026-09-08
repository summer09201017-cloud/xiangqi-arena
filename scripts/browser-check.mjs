/* 🔬 3D 象棋對局場 真瀏覽器冒煙(playwright-core + 系統 Edge/Chrome)。
   跑法:npm run serve(另一個視窗)→ npm run check
        或 CHECK_URL=https://incandescent-stroopwafel-31007a.pages.dev npm run check

   ★ 一律用真滑鼠 page.click,不在 evaluate 裡直接呼叫函式 ——
     evaluate-not-click-guard 存在的理由:繞過真點擊的話,
     「鈕被別的東西蓋住、按不到」這種病照樣全綠。

   ⚠ 線上驗收**看內容不看狀態碼**(施工單 §5):這站是 SPA-ish,任何路徑都可能回 200。 */
import { chromium } from "playwright-core";

const URL = process.env.CHECK_URL || "http://localhost:8801";

let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; }
  catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exitCode = 1; }

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};

const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
/* 📡 打點驗收:攔「回應」不是「請求」——0903 實錘,端點寫錯(/p 而非 /api/ping)時
   請求照樣送得出去、sendBeacon 不看回應、前端零紅燈,而 Worker 回 404、一筆資料都沒進。
   這站 0902 上線到 0903 一天多,/api/summary 裡完全沒有它 ⇒ 只有狀態碼看得出來。 */
const beacons = [];
page.on("response", (r) => { const u = r.url(); if (u.includes("hfpc-play-stats")) beacons.push({ u, s: r.status() }); });
await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "networkidle" });
await page.waitForTimeout(2200);

/* ── 殼與版面 ── */
ok((await page.title()).includes("象棋對局場"), "標題還是「3D 象棋對局場」(網址沒變、身分沒變)");
ok((await page.locator("#verTag").textContent()).includes("每日殘局"), "verTag 講了這一版做了什麼");
ok(await page.evaluate(() => !!window.app), "app 起得來(window.app 在)");

/* ★★ 棋盤不可以溢出 —— 舊版線上那支就是被切掉紅方底線(實機截圖看得到)。
   量的是「畫布有沒有把整張棋盤裝進去」:相機是算出來的,所以只要畫布尺寸對,
   四個角的棋子投影都應該落在畫布內。 */
const measureFit = () => page.evaluate(() => {
  const r = window.app.renderer;
  const canvas = r.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const project = (row, col) => {
    const pos = r.getGridPosition(row, col);
    const v = new THREE.Vector3(pos.x, pos.y, 0).project(r.camera);
    return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
  };
  const corners = [[0, 0], [0, 8], [9, 0], [9, 8]].map(([a, b]) => project(a, b));
  return {
    w: rect.width, h: rect.height,
    inside: corners.every((p) => p.x >= 0 && p.x <= rect.width && p.y >= 0 && p.y <= rect.height),
    corners: corners.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`),
  };
});
const fit = await measureFit();
ok(fit.w > 100 && fit.h > 100, `畫布有真實尺寸(${Math.round(fit.w)}×${Math.round(fit.h)})`);
ok(fit.inside, "★★ 棋盤四個角都在畫布內(舊版就是這裡爆板、紅方底線被切掉)",
  `canvas ${Math.round(fit.w)}×${Math.round(fit.h)} corners=${fit.corners.join(" / ")}`);

// 整個畫布也要在第一屏看得到(不必捲動才看得到自己的底線)
const shell = await page.evaluate(() => {
  const r = document.querySelector(".canvas-shell").getBoundingClientRect();
  return { bottom: r.bottom, vh: window.innerHeight };
});
ok(shell.bottom <= shell.vh + 1, "棋盤整片在第一屏內(不用捲動)",
  `畫布底 ${Math.round(shell.bottom)} vs 視窗高 ${shell.vh}`);

/* ── ⛶ 全螢幕棋盤(0902 使用者:「下棋的畫面太小」)──
   全螢幕的對象是 .stage-panel:狀態列與結算蓋板都要一起進去。
   無頭瀏覽器裡原生 requestFullscreen 可能成功也可能被拒 —— 兩條路都要通(被拒就走 CSS 假全螢幕)。 */
ok(await page.locator("#fsButton").count() === 1 && await page.locator("#fsButton2").count() === 1,
  "棋盤角落與側欄都有 ⛶ 全螢幕鈕");
const fsState = () => page.evaluate(() => {
  const panel = document.querySelector(".stage-panel");
  const c = document.querySelector("#game-container canvas").getBoundingClientRect();
  return {
    isFs: panel.classList.contains("is-fs"), pseudo: panel.classList.contains("pseudo-fs"),
    native: !!document.fullscreenElement, w: c.width, h: c.height, vw: innerWidth, vh: innerHeight,
    toolbar: getComputedStyle(document.getElementById("fsToolbar")).display !== "none",
    overlayInside: !!panel.querySelector("#gameOverOverlay"),
    statusInside: !!panel.querySelector("#statusText"),
  };
});
await page.locator("#fsButton").click();
await page.waitForTimeout(1200);
const fs = await fsState();
ok(fs.isFs, `按 ⛶ 進了全螢幕(${fs.native ? "原生" : "CSS 假全螢幕"})`, JSON.stringify(fs));
ok(fs.w >= fs.vw * 0.9 && fs.h > fit.h * 1.25,
  `★ 全螢幕後畫布真的變大:${Math.round(fit.w)}×${Math.round(fit.h)} → ${Math.round(fs.w)}×${Math.round(fs.h)}(視窗 ${fs.vw}×${fs.vh})`);
ok(fs.toolbar && fs.statusInside && fs.overlayInside,
  "全螢幕裡看得到狀態列 + 提示/後悔/視角/離開 工具列,結算蓋板也在同一個面板內", JSON.stringify(fs));
const fit2 = await measureFit();
ok(fit2.inside, "★ 全螢幕(寬扁畫布)下棋盤四角仍在畫布內", fit2.corners.join(" / "));
await page.locator("#fsExitButton").click();
await page.waitForTimeout(1000);
const fsAfter = await fsState();
ok(!fsAfter.isFs && Math.abs(fsAfter.h - fit.h) < 4,
  "離開全螢幕:版面與畫布尺寸回到原樣", `${Math.round(fsAfter.h)} vs ${Math.round(fit.h)}`);

/* ── ⛶ 直向手機的全螢幕(2026-09-08 使用者實機退件)──
   原話:「手機上的全螢幕,不是真的全螢幕,還能看到一半的選單」。
   ★ 為什麼上面那幾條抓不到:browser-check 跑的是 1366×900 的**寬扁**視窗,
     工具列一行就排完;直向 390×844 那七顆會折成三行,加上狀態列與提示行,
     選單吃掉快一半的螢幕高 —— 只有直向量得出來。
   ⇒ 這一段固定用 iPhone 直向尺寸,守三件事:
     ① 畫布高度 ≈ 視窗高度(棋盤真的吃滿,選單是浮層、不佔高度)
     ② 選單浮層 ≤ 視窗高的 25%
     ③ 棋盤四角仍在畫布內(直向是「寬先滿」,和寬扁那條是不同的分支) */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.locator("#fsButton").click();
await page.waitForTimeout(1200);
const port = await page.evaluate(() => {
  const panel = document.querySelector(".stage-panel");
  const c = document.querySelector("#game-container canvas").getBoundingClientRect();
  const tb = document.getElementById("fsToolbar").getBoundingClientRect();
  return {
    isFs: panel.classList.contains("is-fs"),
    cw: Math.round(c.width), ch: Math.round(c.height),
    vw: innerWidth, vh: innerHeight,
    tbH: Math.round(tb.height),
    tipShown: getComputedStyle(document.getElementById("tipText")).display !== "none",
  };
});
ok(port.isFs, "直向也進得了全螢幕");
ok(port.ch >= port.vh * 0.94 && port.cw >= port.vw * 0.94,
  `★★ 直向全螢幕:棋盤畫布吃滿整個視窗 ${port.cw}×${port.ch}(視窗 ${port.vw}×${port.vh})`,
  JSON.stringify(port));
ok(port.tbH <= port.vh * 0.25,
  `★★ 直向全螢幕:選單浮層只佔 ${port.tbH}px = 視窗高的 ${Math.round((port.tbH / port.vh) * 100)}%(退件時是快一半)`,
  JSON.stringify(port));
ok(!port.tipShown, "直向全螢幕把「先點你的棋子」那行收掉(浮層上重複、又擠棋盤)");
const fit3 = await measureFit();
ok(fit3.inside, "★ 直向全螢幕(瘦高畫布)下棋盤四角仍在畫布內", fit3.corners.join(" / "));
await page.locator("#fsExitButton").click();
await page.waitForTimeout(600);
await page.setViewportSize({ width: 1366, height: 900 });
await page.waitForTimeout(600);

/* ★★ 棋子上的字方向 —— 這是一個**只有放大看才看得出來**的缺陷:
   圓柱頂面 UV 配上 rotateX(π/2) 之後字是轉 90° 的,而象棋有一半的字(車/士/兵/王)
   接近對稱,轉了也看不太出來 ⇒ 掃一眼會放它過關。
   正確值是把八種組合(鏡像 × 0/90/180/270)並排渲染挑出來的,見 screenshots/uv-8.png。
   這條擋的是「有人把那兩行刪掉」——真正的驗收還是要看 screenshots/zoom-black-back.png。 */
const uv = await page.evaluate(() => {
  const t = window.app.renderer.createPieceTexture("馬", false);
  return { rot: t.rotation, cx: t.center.x, cy: t.center.y, repeatX: t.repeat.x, flipY: t.flipY };
});
ok(Math.abs(uv.rot - Math.PI / 2) < 1e-6 && uv.cx === 0.5 && uv.cy === 0.5
   && uv.repeatX === 1 && uv.flipY === true,
  "★★ 棋子貼圖方向 = 不鏡像 + 轉 90°(排列組合挑出來的唯一正解)", JSON.stringify(uv));

/* ── 💡 提示(全艦隊棋類批次)── */
ok(await page.locator("#hintButton").count() === 1, "有「💡 提示」鈕");
await page.locator("#hintButton").click();
await page.waitForTimeout(900);
const h1 = await page.evaluate(() => {
  const a = window.app;
  return {
    hint: a.hint && { from: a.hint.from, to: a.hint.to },
    status: document.getElementById("statusText").textContent,
    marks: a.renderer.highlightMeshes.length,
    legal: a.hint
      ? a.gameLogic.isAllowedMove(a.hint.from.row, a.hint.from.col, a.hint.to.row, a.hint.to.col)
      : false,
  };
});
ok(Boolean(h1.hint), "按下去算得出一手", JSON.stringify(h1));
ok(h1.status.includes("建議"), "狀態列講出建議", h1.status);
ok(h1.marks >= 2, "盤上畫了綠圈(要動的棋)+ 綠點(要去的地方)= " + h1.marks);
ok(h1.legal, "★ 建議的那一手通得過真正的規則(含長將)");

await page.locator("#hintButton").click();
await page.waitForTimeout(500);
const h2 = await page.evaluate(() => JSON.stringify(window.app.hint));
ok(h2.includes(JSON.stringify(h1.hint.from).slice(1, -1)),
  "同一個局面按兩次 ⇒ 同一手(不跳針)", h2.slice(0, 90));

/* ── 開局譜 ── */
const books = await page.evaluate(() =>
  [...document.querySelectorAll("#openingSelect option")].map((o) => o.textContent));
ok(books.length === 6, `開局譜有 6 個選項(五種譜 + 不載入)=${books.length}`, books.join(" / "));
ok(books.some((b) => b.includes("中炮譜")) && books.some((b) => b.includes("仙人指路譜")),
  "五種譜名和舊版一致", books.join(" / "));

/* ── 2D/3D 視角 ── */
await page.selectOption("#viewSelect", "2d");
await page.waitForTimeout(500);
ok(await page.evaluate(() => window.app.renderer.viewMode === "2d"
  && window.app.renderer.controls.enableRotate === false),
  "切到 2D:相機轉正、而且鎖住滑鼠旋轉(不然兩套控制打架)");
await page.locator("#rotateLeftButton").click();
await page.waitForTimeout(300);
ok(await page.evaluate(() => window.app.renderer.boardSpin === -45), "2D 左轉 45°");
await page.selectOption("#viewSelect", "3d");
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.app.renderer.viewMode === "3d"
  && window.app.renderer.boardSpin === 0), "切回 3D:旋轉歸零、滑鼠可轉");

/* ── 存讀檔 ── */
await page.locator("#saveButton").click();
await page.waitForTimeout(300);
ok(await page.evaluate(() => document.getElementById("statusText").textContent.includes("已存檔")),
  "存檔成功");
ok(await page.evaluate(() => !!localStorage.getItem("xiangqi-arena-save-v1")),
  "★ 用新的存檔鍵(不去讀舊站那支引擎的 xiangqi-3d-save-v3,格式對不上)");
await page.locator("#loadButton").click();
await page.waitForTimeout(500);
ok(await page.evaluate(() => document.getElementById("statusText").textContent.includes("已讀檔")),
  "讀檔成功");

/* ── 📅 每日殘局 ── */
await page.locator("#dailyButton").click();
await page.waitForTimeout(1500);
const daily = await page.evaluate(() => {
  const a = window.app;
  return {
    key: a.daily && a.daily.key,
    name: a.daily && a.daily.puzzle.name,
    total: a.daily && a.daily.set.puzzles.length,
    line: document.getElementById("dailyLine").textContent,
    lineShown: !document.getElementById("dailyLine").classList.contains("hidden"),
    bookDisabled: document.getElementById("openingSelect").disabled,
    saveDisabled: document.getElementById("saveButton").disabled,
    bookHint: document.getElementById("openingHint").textContent,
  };
});
ok(/^\d{4}-\d{2}-\d{2}$/.test(daily.key || ""), `進每日模式,日期鍵正確(${daily.key}「${daily.name}」)`);
ok(daily.total === 5, `今天這一組是 5 題(=${daily.total})`);
ok(daily.lineShown && daily.line.includes("題"), "常駐狀態行帶進度", daily.line);
ok(daily.bookDisabled && daily.bookHint.includes("殘局不吃開局譜"),
  "★ 每日模式把開局譜選單鎖住**並講明原因**(施工單 §4.2)", daily.bookHint);
ok(daily.saveDisabled, "★ 每日模式不給存檔(施工單 §4.3)");

// 每日模式按存檔要說明原因,不是靜靜不做
ok(await page.evaluate(() => {
  const a = window.app;
  a.saveGame();
  return document.getElementById("statusText").textContent.includes("每日殘局不用存檔");
}), "每日模式按存檔會**講原因**(不是靜靜不做)");

/* ── 悔棋 ── */
/* ★ 0903 修假紅:這一段原本沿用上一段留下的「每日殘局」局面,而每日題是日期種子生成的 ——
   今天(09-03)那一組裡,紅方最佳一手直接把棋下完 ⇒ #gameOverOverlay 蓋住 #undoButton,
   locator.click 等 30 秒逾時。0902 的題目不會,所以當天全綠、隔天無人改動卻自己紅了。
   ⇒ 悔棋要在**確定性的開局盤面**上驗(按「重新開局」回一般模式),日期不可以是斷言的一部分。
   同族:skill test-clock-inject「時間是環境,不是規則」。 */
await page.locator("#newGameButton").click();
await page.waitForTimeout(900);
ok(await page.evaluate(() => !window.app.daily && document.getElementById("gameOverOverlay").classList.contains("hidden")),
  "悔棋前先回到一般模式的開局盤面(不吃當天的殘局)");
await page.evaluate(() => {
  const a = window.app;
  // 走一步(和真手指同一條 handleSquareClick 管線)
  const mv = a.ai.calculateBestMove(a.gameLogic.getBoardState(), "red", "hard");
  a.gameLogic.selectedPiece = { row: mv.from.row, col: mv.from.col };
  a.handleSquareClick(mv.to.row, mv.to.col);
});
await page.waitForTimeout(1400);
const canUndo = await page.evaluate(() => !document.getElementById("undoButton").disabled);
ok(canUndo, "走過一步之後「後悔一步」才亮起來");
if (canUndo) {
  const beforeSig = await page.evaluate(() => window.app.gameLogic.positionKey());
  await page.locator("#undoButton").click();
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => document.getElementById("statusText").textContent.includes("已返回")),
    "悔棋有回報退了幾步");
  ok(await page.evaluate((s) => window.app.gameLogic.positionKey() !== s, beforeSig),
    "悔棋之後局面真的變了");
}

const opens = beacons.filter((b) => /[?&]g=xiangqi-arena(&|$)/.test(b.u));
ok(opens.length > 0 && opens.every((b) => b.s === 200), "📡 開啟打點:伺服器收下(200)", JSON.stringify(opens));
ok(!beacons.some((b) => b.s === 404), "📡 沒有任何打點被伺服器退回 404(端點/參數寫對了)", JSON.stringify(beacons.filter((b) => b.s !== 200)));

ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 240));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
