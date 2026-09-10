// 🔬 全螢幕橫向:AI 提示文字不再擋棋盤(2026-09-10 使用者實機退件:
// 「橫式AI提示在下方,依然擋住棋盤,建議做可以收起AI提示或AI提示移到最上方」)。
// 跑法:python -m http.server 8801(另一個視窗)→ node scripts/check-hint-position.mjs
//      (或 CHECK_URL=線上網址 node scripts/check-hint-position.mjs)
//
// 守三件:①提示文字現在貼在工具列**下緣**,不是螢幕最下緣(不會蓋到棋盤下半部)
//        ②折工具列時,提示文字跟著一起藏起來 ③展開回來,提示文字也跟著回來。
import { chromium } from "playwright-core";

const URL = process.env.CHECK_URL || "http://localhost:8801";
const LANDSCAPE_SHORT = { width: 844, height: 390 };   // 使用者反映的「橫式」矮螢幕

let browser = null;
for (const channel of ["msedge", "chrome"]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; }
    catch { /* 換下一個 channel */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exitCode = 1; }

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
    if (cond) { pass++; console.log("  ✓ " + msg); }
    else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};

const page = await browser.newPage({ viewport: LANDSCAPE_SHORT });
await page.goto(URL + "?v=" + Date.now(), { waitUntil: "domcontentloaded" });
/* ⚠ 這個尺寸(844×390)剛好命中「橫向矮螢幕自動套用全螢幕」的門檻(checkLandscapeAuto),
   .is-fs 在載入時就自動套上了,不必也不應該再手動點 #fsButton
   (那顆鈕在真全螢幕時反而是 display:none,點了等於白點,乾等 15 秒逾時)。 */
await page.waitForFunction(() => document.querySelector(".stage-panel")?.classList.contains("is-fs"), null, { timeout: 10000 });
await page.click("#fsHintButton");                                // 觸發一次提示,讓 .status-pill 有內容
await page.waitForFunction(() => (document.getElementById("statusText")?.textContent || "").includes("建議走"), null, { timeout: 5000 });

const toolbarBox = await page.locator("#fsToolbar").boundingBox();
const pillBox = await page.locator(".status-pill").boundingBox();
ok(toolbarBox && pillBox, "工具列與提示文字都量得到位置");
if (toolbarBox && pillBox) {
    ok(pillBox.y >= toolbarBox.y + toolbarBox.height - 2,
        "★★ 提示文字貼在工具列下緣(不是貼螢幕最下緣、不會蓋到棋盤下半部)",
        `工具列底 ${(toolbarBox.y + toolbarBox.height).toFixed(1)} / 提示頂 ${pillBox.y.toFixed(1)}`);
}

console.log("\n── 折疊工具列時,提示文字要一起藏起來 ──");
await page.click("#fsFoldButton");
await page.waitForTimeout(300);
ok(!(await page.locator(".status-pill").isVisible()), "★ 折起來之後,提示文字也跟著不見了");

await page.click("#fsFoldButton");
await page.waitForTimeout(300);
ok(await page.locator(".status-pill").isVisible(), "★ 展開之後,提示文字也跟著回來");

await browser.close();
console.log("\n" + (fail === 0 ? "🟢" : "🔴") + ` hint-position:${pass} 過 / ${fail} 失敗\n`);
process.exit(fail === 0 ? 0 : 1);
