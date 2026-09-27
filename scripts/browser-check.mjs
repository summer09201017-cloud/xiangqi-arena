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

/* ── 🖐 手機轉棋盤的靈敏度(2026-09-09 使用者實機退件)──
   原話:「手機版棋盤旋轉與移動太靈敏、太快了」。
   量的是使用者真的感覺到的那個數字:**一根手指劃 150px,鏡頭轉幾度**。
   OrbitControls:2π × 拖曳像素 ÷ 容器高 × rotateSpeed ⇒ 速度 1.0 在 390×844 上是 64°/150px。
   ★ 一定要另開一個 hasTouch 的 context:`pointer: coarse` 是**裝置能力**,
     `setViewportSize` 改不了它 ⇒ 在原本這個 page 上量,量到的永遠是滑鼠那一檔。
   ★ 用 TouchEvent 手刻:three r128 的 OrbitControls 觸控走 touchstart/touchmove/touchend
     (pointerdown 那條分支裡的 touch 是 `// TODO touch`,根本沒接)⇒ 派 pointer 事件量不到東西。 */
const touchCtx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});
const tp = await touchCtx.newPage();
await tp.goto(URL + "/?v=" + Date.now(), { waitUntil: "domcontentloaded" });
await tp.waitForTimeout(2500);
await tp.locator("#fsButton").click();
await tp.waitForTimeout(1200);
const swipe = await tp.evaluate(async () => {
  const r = window.app.renderer;
  const el = r.renderer.domElement;
  const box = el.getBoundingClientRect();
  const y = Math.round(box.top + box.height / 2);
  const x0 = Math.round(box.left + box.width * 0.25);
  const deg = (rad) => (rad * 180) / Math.PI;
  const fire = (type, cx) => {
    /* ⚠ 一定要給 pageX/pageY:OrbitControls 的觸控分支讀的是 `event.touches[0].pageX`
       (r128 第 570/625 行),只給 clientX 的話它讀到 0 ⇒ 位移永遠是 0、量出「轉 0°」
       看起來像功能壞了(0909 我第一版就這樣假紅了一輪)。 */
    const t = new Touch({
      identifier: 1, target: el,
      clientX: cx, clientY: y, pageX: cx, pageY: y, screenX: cx, screenY: y,
    });
    el.dispatchEvent(new TouchEvent(type, {
      touches: type === "touchend" ? [] : [t],
      targetTouches: type === "touchend" ? [] : [t],
      changedTouches: [t], bubbles: true, cancelable: true,
    }));
  };
  const before = r.controls.getAzimuthalAngle();
  /* 俯角要在**拖曳之前**量:這支的公轉軸是 Y,水平拖曳會同時改到俯角
     ⇒ 拖完再量會拿到 49° 而不是預設的 56°(0909 踩過)。 */
  const p0 = r.camera.position.clone();
  const elevation = Math.round(deg(Math.atan2(p0.z, Math.hypot(p0.x, p0.y))));
  fire("touchstart", x0);
  for (let i = 1; i <= 15; i++) fire("touchmove", x0 + i * 10);   // 共 150px
  fire("touchend", x0 + 150);
  /* ⚠ 要等阻尼跑完才量:enableDamping 時每一次 update 只吃掉 dampingFactor(0.05)那一份,
     剩下的靠 animate 的 rAF 迴圈慢慢收 ⇒ 立刻量會拿到「還在半路上」的角度
     (0909 我第一版量到 9°,以為是設定太小,其實是量太早)。 */
  await new Promise((res) => setTimeout(res, 1400));
  const after = r.controls.getAzimuthalAngle();
  let d = Math.abs(deg(after - before)) % 360;
  if (d > 180) d = 360 - d;
  /* 俯角要從**相機座標**自己算,不要用 controls.getPolarAngle():
     這支的 OrbitControls 公轉軸是 Y(quat 在建構時照當時的 camera.up=(0,1,0) 算好就凍住,
     之後才把 camera.up 改成 (0,0,1))⇒ getPolarAngle 是從 +Y 量的,拿來當俯角會得到 -34°。 */
  return {
    rotateSpeed: r.controls.rotateSpeed, panSpeed: r.controls.panSpeed,
    canvasH: Math.round(box.height), degPer150px: Math.round(d),
    coarse: matchMedia("(pointer: coarse)").matches,
    elevation,          // 拖曳前量的(見上面那段註解)
  };
});
ok(swipe.coarse, "觸控 context 真的是 pointer: coarse(不然量到的是滑鼠那一檔)", JSON.stringify(swipe));
ok(swipe.rotateSpeed <= 0.25,
  `★★ 手機的 rotateSpeed 有調降:${swipe.rotateSpeed}(退件時是預設 1.0;0909 先降到 0.4,`
  + '0910 使用者第二次反映「降靈敏都過高」再砍半到 0.2)', JSON.stringify(swipe));
/* 0910 更新門檻:0.4 那版量到約 25°,使用者仍嫌太靈敏 ⇒ 0.2 之後約 12~13°。
   下限留 6° 是防「調過頭變成拖不動」——真的拖不動比太靈敏更難用。 */
ok(swipe.degPer150px >= 6 && swipe.degPer150px <= 20,
  `★★ 一根手指劃 150px ⇒ 鏡頭轉 ${swipe.degPer150px}°(退件時 ~64°,0.4 那版 ~25°;太小會變成拖不動)`,
  JSON.stringify(swipe));
ok(swipe.elevation >= 52 && swipe.elevation <= 60,
  `★ 直向的預設俯角 = ${swipe.elevation}°(和桌機同一個)`
  + " —— 0908 那版壓到 74°,量出來棋盤寬 354→327,棋子反而小 8%(那版簡歷說錯了)",
  JSON.stringify(swipe));
await touchCtx.close();

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

/* ── 🎥 視角工具列(view-kit,2026-09-20 六款 3D 棋類統一:預設三段 + 滑桿 + 換邊 + 重置)── */
const vk = (sel) => page.locator("#viewKitMount " + sel);
const vkVal = (sel) => page.evaluate((s) => Number(document.querySelector("#viewKitMount " + s).value), sel);
ok(await vk("[data-vk-view]").count() === 3, "視角工具列有三顆預設鈕(斜俯視 / 正俯視 / 對局視角)");
ok(await vk("[data-vk-range='yaw']").count() === 1 && await vk("[data-vk-range='pitch']").count() === 1,
  "有「水平旋轉」+「俯視角度」兩條滑桿");
await vk("[data-vk-flip]").click();
await page.waitForTimeout(700);   // 補間 320ms
ok(await vkVal("[data-vk-range='yaw']") === 180, "按 🔃 換邊 → 水平旋轉滑桿 = 180°", String(await vkVal("[data-vk-range='yaw']")));
await vk("[data-vk-view='flat']").click();
await page.waitForTimeout(700);
ok(await vkVal("[data-vk-range='pitch']") === 88
  && await page.evaluate(() => document.querySelector("#viewKitMount [data-vk-view='flat']").getAttribute("aria-pressed") === "true"),
  "按「正俯視」→ 俯視角度滑桿 = 88°、那顆鈕亮起");
await vk("[data-vk-reset]").click();
await page.waitForTimeout(300);
{
  const y = await vkVal("[data-vk-range='yaw']"), p = await vkVal("[data-vk-range='pitch']");
  ok(y === 0 && p >= 54 && p <= 60, "按 🎯 重置視角 → 水平 0°、俯視回開場 56° 左右", `yaw=${y} pitch=${p}`);
}
await page.selectOption("#viewSelect", "2d");
ok(await page.evaluate(() => document.getElementById("viewKitMount").classList.contains("hidden")), "切到 2D:視角工具列藏起來(2D 不能轉)");
await page.selectOption("#viewSelect", "3d");
ok(await page.evaluate(() => !document.getElementById("viewKitMount").classList.contains("hidden")), "切回 3D:視角工具列回來");

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


/* ══════ 🐾 動物對手(2026-09-28,skill animal-opponent-kit;照 3D-Xiangqi 的 🐾 段改選擇器)══════
   檔案側對賬 → 真操作(下拉 + 重新開局)開一局中級 → 坐對面 / 鐵則遍歷 / 頭在畫面裡 / 凳子落地 / 名牌帶臉
   → 桌機全螢幕:臉沒被工具列 / 狀態文字蓋到(≥1000px 畫布從工具列底下開始)→ 手機橫向(自動全螢幕)/ 直向:頭在畫面裡
   → 讓位縮盤 ≤ 25% → 走一手等牠回手(figs.log 有 think + place)→ 姿勢手動推時間 → 🔃 換邊仍坐對面 → 對局視角
   → 三段開關 / 2D 收起 → 難度換人 → 人聲 runtime → 每日 = 🦉。★ Z-up:pos 回世界 XY,相機在 -Y 時牠在 +Y。 */
console.log("—— 🐾 動物對手 ——");
{
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { VOICE_FILES } = await import(pathToFileURL(join(root, "js", "voicePhrases.js")).href);
  const vdir = join(root, "voice");
  const mp3 = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((f) => f.endsWith(".mp3")).sort() : [];
  const want = [...VOICE_FILES].sort();
  ok(mp3.join() === want.join(), `🗣 voice/ 有 ${mp3.length} 支 mp3,跟詞庫 ${want.length} 句一一對應`);
  const sw = fs.readFileSync(join(root, "sw.js"), "utf8");
  const missing = mp3.filter((f) => !sw.includes(`"./voice/${f}"`));
  ok(missing.length === 0 && sw.includes('"./voice/manifest.json"'), `🗣 sw.js 清單含 manifest + 每支 mp3(gen-voice 照目錄重生)${missing.length ? ":漏 " + missing.join(",") : ""}`);
  let manifestOk = false;
  try { const mf = JSON.parse(fs.readFileSync(join(vdir, "manifest.json"), "utf8")); manifestOk = mp3.length > 0 && mp3.every((f) => mf[f.replace(/\.mp3$/, "")] === "voice/" + f); } catch { /* 沒烤 */ }
  ok(manifestOk, "🗣 manifest.json 的鍵值跟目錄一致");
  const tiny = mp3.filter((f) => fs.statSync(join(vdir, f)).size < 2048);
  ok(tiny.length === 0, `🗣 每支 mp3 > 2KB(空檔 = 烤失敗)${tiny.length ? ":" + tiny.join(",") : ""}`);
  const webSpeech = fs.readdirSync(join(root, "js")).filter((f) => f.endsWith(".js") && fs.readFileSync(join(root, "js", f), "utf8").includes("speech" + "Synthesis"));
  ok(webSpeech.length === 0, `🗣 js/ 裡沒有 Web Speech 機器聲${webSpeech.length ? ":" + webSpeech.join(",") : ""}`);
  const kit = join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "skills", "animal-opponent-kit", "assets");
  if (fs.existsSync(kit)) {
    const drift = [["animals.js", "animals.js"], ["voice.js", "voice.js"], ["three-shim.js", "three-global-shim.js"]]
      .filter(([site, asset]) => fs.readFileSync(join(root, "js", site), "utf8") !== fs.readFileSync(join(kit, asset), "utf8")).map(([site]) => site);
    ok(drift.length === 0, `🐾 引擎三支與 skill 同一份${drift.length ? ":漂移 " + drift.join(",") : ""}`);
  }
}
await page.setViewportSize({ width: 1366, height: 900 });
await page.selectOption("#sideSelect", "red");
await page.waitForTimeout(400);
await page.selectOption("#petSelect", "voice");
await page.selectOption("#difficultySelect", "medium");
await page.locator("#newGameButton").click();
await page.waitForFunction(() => window.app.opponent && window.app.opponent.kind === "cat" && !window.app.daily, null, { timeout: 5000 });
await page.waitForTimeout(500);
const pet0 = await page.evaluate(() => {
  const O = window.app.opponent, f = O.figure;
  let neck = 0, eyes = 0, ears = 0, brows = 0, mouth = 0;
  f.group.traverse((o) => { if (o.userData.neck) neck++; if (o.userData.eye) eyes++; if (o.userData.ear) ears++; if (o.userData.brow) brows++; if (o.userData.mouth) mouth++; });
  return { ...O.probe(), neck, eyes, ears, brows, mouth, chip: document.getElementById("petChip").textContent,
    chipShown: !document.getElementById("petChip").classList.contains("hidden"), petOn: document.body.classList.contains("pet-on"),
    capsule: !!window.THREE.CapsuleGeometry, fsSel: document.getElementById("fsPetSelect").options.length };
});
ok(pet0.figure && pet0.visible && pet0.kind === "cat" && pet0.pos.y > 0, `🐾 中級 ⇒ 🐱 橘貓坐在對面(黑方那一側,世界 ${JSON.stringify(pet0.pos)},scale ${pet0.scale})`);
ok(pet0.capsule, "🐾 three-shim 補上了 r128 沒有的 CapsuleGeometry");
ok(pet0.neck === 1 && pet0.eyes === 2 && pet0.ears === 2 && pet0.brows === 2 && pet0.mouth === 1, "🐾 人物鐵則遍歷:脖子 1、眼 2、耳 2、眉 2、嘴 1");
ok(pet0.head.inside, `🐾 桌機:頭頂在畫面裡(NDC ${pet0.head.x}, ${pet0.head.y})`);
ok(pet0.stoolZ <= pet0.floorZ + 0.05, `🐾 凳子不懸空(凳底 z ${pet0.stoolZ} ≤ 板底 ${pet0.floorZ})`);
ok(pet0.chipShown && /^🐱/.test(pet0.chip) && pet0.petOn && pet0.fsSel === 3, `🐾 名牌帶動物(${pet0.chip})、body.pet-on、全螢幕工具列也有三段下拉`);
const hudHits = (box) => [...document.querySelectorAll("#fsToolbar, .status-pill, #turnChip, #petChip, #fsButton")].filter((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !(r.right < box.l || r.left > box.r || r.bottom < box.t || r.top > box.b);
}).map((el) => el.id || el.className);
const faceAt = () => page.evaluate((fn) => { const hits = eval(fn); const p = window.app.opponent.probe(); return { box: p.headBox, head: p.head, hits: hits(p.headBox) }; }, `(${hudHits.toString()})`);
const faceDesk = await faceAt();
ok(faceDesk.hits.length === 0, `🐾 桌機:牠的臉沒被任何浮層蓋到(頭框 ${JSON.stringify(faceDesk.box)}${faceDesk.hits.length ? ";蓋到 " + faceDesk.hits.join(",") : ""})`);
await page.locator("#fsButton").click();
await page.waitForTimeout(1200);
const faceFs = await faceAt();
ok(faceFs.head.inside && faceFs.hits.length === 0, `🐾 桌機全螢幕:頭在畫面裡(${faceFs.head.x}, ${faceFs.head.y})、臉沒被工具列 / 狀態文字蓋到${faceFs.hits.length ? ":" + faceFs.hits.join(",") : ""}`);
await page.locator("#fsExitButton").click();
await page.waitForTimeout(600);
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(1200);
const faceLand = await faceAt();
ok(faceLand.head.inside, `🐾 手機橫向(自動全螢幕):頭在畫面裡(${faceLand.head.x}, ${faceLand.head.y})${faceLand.hits.length ? ";工具列蓋到 " + faceLand.hits.join(",") + "(小螢幕接受,折起 ▲ 就看得到)" : ""}`);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
const facePort = await faceAt();
ok(facePort.head.inside, `🐾 手機直向:頭在畫面裡(${facePort.head.x}, ${facePort.head.y})`);
await page.setViewportSize({ width: 1366, height: 900 });
await page.waitForTimeout(1200);
await page.evaluate(() => { if (window.app.isFullscreen()) window.app.exitFullscreen(); });
await page.waitForTimeout(600);
const shrink = await page.evaluate(() => {
  const r = window.app.renderer;
  const px = (row, col) => { const g = r.getGridPosition(row, col); const v = new THREE.Vector3(g.x, g.y, 0).project(r.camera); const { w, h } = r.containerSize(); return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }; };
  const width = () => { const a = px(0, 0), b = px(0, 8); return Math.hypot(b.x - a.x, b.y - a.y); };
  const on = width();
  window.app.opponent.setMode("off"); const off = width();
  window.app.opponent.setMode("voice");
  return { on: Math.round(on), off: Math.round(off), ratio: +(on / off).toFixed(3) };
});
/* 讓位上限是「相機距離 1.28 倍」;這裡量的是**近邊**(紅方底線)的寬,透視下近邊縮得比 1/1.28 多一點 ⇒ 1366×900 的畫布(16:10)頂到上限時量到 0.74。
   3D-Xiangqi 同一個盤在 1000×720 量到 0.76。門檻 0.72 = 上限 + 透視的份;再低就是上限被人改了。 */
ok(shrink.ratio >= 0.72 && shrink.ratio <= 1.0001, `🐾 為牠讓位但棋盤最多縮 28%(近邊寬:開 ${shrink.on}px / 關 ${shrink.off}px = ${shrink.ratio};距離上限 1.28 倍)`);
/* 走一手(紅炮二平五)等牠回手:think 在牠開算時、place 在牠落子後 —— 看 figs.log,不是 grep 程式碼 */
const moved = await page.evaluate(async () => {
  const a = window.app;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  a.handleSquareClick(2, 1); a.handleSquareClick(2, 4);
  for (let i = 0; i < 60 && !(!a.aiThinking && a.gameLogic.currentPlayer === "red" && a.opponent.figs.log.some((e) => e.kind === "place")); i++) await sleep(250);
  await sleep(200);
  return { turn: a.gameLogic.currentPlayer, log: a.opponent.figs.log.map((e) => e.kind), focus: !!a._focus };
});
ok(moved.turn === "red" && moved.log.includes("think") && moved.log.includes("place") && moved.focus, `🐾 事件真的接到(figs.log):${moved.log.join(",")}`);
const pose = await page.evaluate(() => {
  const O = window.app.opponent, f = O.figure, F = O.figs;
  const said = []; const o = O.voice.say.bind(O.voice); O.voice.say = (a, e, d) => { said.push(a + ":" + e); return o(a, e, d); };
  O.react("win", "win"); F.update(0.4);
  const up = { armL: +f.arms[0].rotation.x.toFixed(2), armR: +f.arms[1].rotation.x.toFixed(2), open: f.mouthOpen.visible };
  F.update(3.5); F.update(0.5);
  const back = { armL: +f.arms[0].rotation.x.toFixed(2), smile: f.smile.visible };
  O.react("lose", "lose"); F.update(0.4);
  const sad = { pitch: +f.head.rotation.x.toFixed(2), smileZ: +f.smile.rotation.z.toFixed(2) };
  F.update(3.5); F.update(0.5);
  O.react("think", null); F.update(0.4);
  const think = { armR: +f.arms[1].rotation.x.toFixed(2), tilt: +f.head.rotation.z.toFixed(2) };
  O.cancel(); F.update(1);
  O.voice.say = o;
  return { up, back, sad, think, said };
});
ok(pose.up.armL < -2.2 && pose.up.armR < -2.2 && pose.up.open, `🐾 win:雙手高舉 + 張嘴(${JSON.stringify(pose.up)})`);
ok(Math.abs(pose.back.armL + 1.2) < 0.15 && pose.back.smile, `🐾 反應完回休息姿勢、笑臉回來(${JSON.stringify(pose.back)})`);
ok(pose.sad.pitch > 0.3 && pose.sad.smileZ < 1.6, `🐾 lose:低頭 + 苦臉(${JSON.stringify(pose.sad)})`);
ok(pose.think.armR < -1.9 && pose.think.tilt < -0.05, `🐾 think:手托腮、頭歪(${JSON.stringify(pose.think)})`);
ok(pose.said.join(" ") === "cat:win cat:lose", `🗣 同一個入口也叫了人聲:${pose.said.join(" ")}`);
/* 🔃 換邊(真的按側欄工具列那顆):相機轉到 +Y 那側 ⇒ 牠要坐到 -Y(還是你對面),頭還在畫面裡。
   ★ 這一條順手抓到既有 bug:adapter 只建一次、而每局 initScene 都是新相機 ⇒ 「重新開局」後工具列轉的是丟掉的舊相機(滑桿動、畫面不動)。
     上面 view-kit 那段是在第一局驗的所以一直綠;這裡是「重新開局」之後,相機真的要轉。 */
const camBefore = await page.evaluate(() => window.app.renderer.camera.position.y);
const beforeFlip = await page.evaluate(() => window.app.opponent.probe().pos);
await page.locator("#viewKitMount [data-vk-flip]").click();
await page.waitForTimeout(900);
const afterFlip = await page.evaluate(() => { window.app.opponent.update(0.016); return window.app.opponent.probe(); });
const camAfter = await page.evaluate(() => window.app.renderer.camera.position.y);
ok(Math.sign(camBefore) !== Math.sign(camAfter), `🎥 重新開局之後 🔃 換邊真的轉了相機(y ${camBefore.toFixed(1)} → ${camAfter.toFixed(1)};adapter 跟著新相機重建)`);
ok(Math.sign(beforeFlip.y) !== Math.sign(afterFlip.pos.y) && afterFlip.head.inside, `🐾 🔃 換邊後牠還是坐你對面(y ${beforeFlip.y} → ${afterFlip.pos.y})、頭在畫面裡(${afterFlip.head.x}, ${afterFlip.head.y})`);
await page.locator('#viewKitMount [data-vk-view="sit"]').click();
await page.waitForTimeout(900);
const sitPet = await page.evaluate(() => window.app.opponent.probe().head);
ok(sitPet.inside, `🐾 對局視角(34°):頭頂在畫面裡(${sitPet.x}, ${sitPet.y})`);
await page.locator("#viewKitMount [data-vk-reset]").click();
await page.waitForTimeout(600);
const toggled = await page.evaluate(() => {
  const O = window.app.opponent;
  O.setMode("off"); const off = { visible: O.figure.group.visible, saved: localStorage.getItem("xiangqi-arena-pet"), chip: document.body.classList.contains("pet-on") };
  O.setMode("mute"); const mute = { visible: O.figure.group.visible, voiceOn: O.voiceOn };
  O.setMode("voice");
  return { off, mute };
});
ok(toggled.off.visible === false && toggled.off.saved === "off", `🐾 關掉 ⇒ 隱藏、localStorage 記 off(${JSON.stringify(toggled.off)})`);
ok(toggled.mute.visible === true && toggled.mute.voiceOn === false, `🐾 不出聲 ⇒ 還坐著、不唸(${JSON.stringify(toggled.mute)})`);
await page.selectOption("#viewSelect", "2d");
await page.waitForTimeout(500);
const in2d = await page.evaluate(() => { window.app.opponent.update(0.016); const O = window.app.opponent; return { on: O.on, visible: O.figure.group.visible, fit: O.fitPoints().length, chipHidden: document.getElementById("petChip").classList.contains("hidden") }; });
await page.selectOption("#viewSelect", "3d");
await page.waitForTimeout(500);
const back3d = await page.evaluate(() => { window.app.opponent.update(0.016); const O = window.app.opponent; return { on: O.on, visible: O.figure.group.visible, inside: O.probe().head.inside }; });
ok(!in2d.on && in2d.visible === false && in2d.fit === 0 && in2d.chipHidden && back3d.on && back3d.visible && back3d.inside, `🐾 2D 視角收起(不畫、不讓位、名牌藏)、切回 3D 坐回來(${JSON.stringify(in2d)} → ${JSON.stringify(back3d)})`);
await page.selectOption("#difficultySelect", "master");
await page.waitForTimeout(400);
const master = await page.evaluate(() => ({ kind: window.app.opponent.kind, chip: document.getElementById("petChip").textContent }));
ok(master.kind === "owl" && /^🦉/.test(master.chip), `🐾 難度換 Lv.4 ⇒ 對面立刻換 🦉(${master.chip})`);
await page.selectOption("#difficultySelect", "medium");
await page.waitForFunction(() => window.app.voice && window.app.voice.ready(), null, { timeout: 10000 }).catch(() => {});
const v = await page.evaluate(() => ({ ready: window.app.voice.ready(), has: window.app.voice.has("owl", "check"), yes: window.app.voice.say("cat", "win"), no: window.app.voice.say("cat", "nope") }));
ok(v.ready && v.has && v.yes === true && v.no === false, `🗣 人聲 runtime:manifest 載到、cat-win 送去放、沒烤的不唸(${JSON.stringify(v)})`);
await page.locator("#dailyButton").click();
await page.waitForFunction(() => window.app.daily && window.app.opponent.kind === "owl", null, { timeout: 5000 });
const owl = await page.evaluate(() => ({ ...window.app.opponent.probe(), chip: document.getElementById("petChip").textContent }));
ok(owl.kind === "owl" && owl.visible && owl.head.inside && /^🦉/.test(owl.chip), `🐾 每日殘局 ⇒ 🦉 貓頭鷹守黑方(${owl.chip};頭 ${owl.head.x}, ${owl.head.y})`);
await page.locator("#newGameButton").click();
await page.waitForTimeout(600);

ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 240));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
