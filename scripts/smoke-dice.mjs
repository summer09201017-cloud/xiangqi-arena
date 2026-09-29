#!/usr/bin/env node
/**
 * smoke-dice.mjs — 🎲 擲骰 / 🪙 擲硬幣決定先後 + 執黑兩個洞 真瀏覽器冒煙(v24;skill dice-coin-toss「驗收」段)
 *
 *   node scripts/smoke-dice.mjs                                                   # 自己起本機靜態站(port 8768)
 *   BASE=https://incandescent-stroopwafel-31007a.pages.dev/ node scripts/smoke-dice.mjs   # 線上
 *
 * ① 選「🎲 擲骰決定」→ 浮層開始鈕出現;每顆骰子畫面朝上的面 == 點數(判定 = 畫面);開始鈕 ≥44px
 * ② 擲骰期間棋盤不收點(直接叫 handleSquareClick 驗 tossing 那道旗標,不是驗「浮層蓋住」)
 * ③ 你 6 點 ⇒ 你執紅、電腦不搶;「重新開局」重擲、電腦 6 點 ⇒ 你執黑、電腦 6 秒內走第一手
 * ④ 執黑悔到開局 ⇒ 電腦重新走第一手、輪到你(以前卡住)
 * ⑤ 局號守門:電腦先走時連按兩次「重新開局」⇒ 新局只有一手(以前舊局那手會跑進新局)
 * ⑥ 🪙 硬幣朝上那面 == 結果,開局後執色跟浮層寫的誰先對得上
 * ⑦ 重新整理(選著擲骰)⇒ 開頁那局也擲;📅 每日殘局不擲、一律執紅;⑧ 全程零 pageerror
 * 骰子結果用 addInitScript 換掉 Math.random(只在擲骰那段給指定序列),不碰站內程式。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json", ".svg": "image/svg+xml", ".mp3": "audio/mpeg" };

let server = null;
let BASE = process.env.BASE;
if (!BASE) {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(8768, "127.0.0.1", r));
  BASE = "http://127.0.0.1:8768/";
}

const results = [];
const check = (c, n, d = "") => results.push([c ? "🟢" : "🔴", n, d]);
let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* 換下一個 */ }
}
browser ||= await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
/* 🎲 指定點數:app.diceRng 先吐 __rigRolls 佇列、用完回真亂數。
   ⚠ 不能照 chess5 換掉 Math.random —— 這站動物每幀都在用它,佇列會在擲骰前就被吃光(實測骰出來跟塞的不一樣) */
const RIG = () => { const a = window.app; a.diceRng = () => (window.__rigRolls.length ? window.__rigRolls.shift() : Math.random()); };
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });

const GO = ".dt-ov .dt-go:not([hidden])";
const st = () => page.evaluate(() => {
  const a = window.app;
  return { side: a.playerSide(), choice: a.sideChoice, tossing: a.tossing, turn: a.gameLogic.currentPlayer, n: a.gameLogic.history.length, thinking: a.aiThinking };
});
const facesMatch = () => page.evaluate(async () => {
  const { topFace } = await import(new URL("js/dice-toss.js", document.baseURI).href);
  return [...document.querySelectorAll(".dt-ov .dt-die, .dt-ov .dt-coin")].map((el) => [String(topFace(el)), String(el.dataset.v)]);
});
const waitAiDone = (n) => page.waitForFunction((k) => {
  const a = window.app; return !a.aiThinking && a.gameLogic.history.length >= k;
}, n, { timeout: 6000 }).catch(() => {});
async function pick(value, rig) {
  await page.evaluate((r) => { window.__rigRolls = r.slice(); }, rig || []);
  await page.evaluate(RIG);
  await page.selectOption("#sideSelect", value);
}
async function goAndSettle(expectSide) {
  const btn = page.locator(GO);
  const box = await btn.boundingBox();
  check(box && box.height >= 44 && box.width >= 44, "開始鈕 ≥44px", box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "沒有框");
  await btn.click();
  await page.waitForSelector(".dt-ov", { state: "detached", timeout: 5000 }).catch(() => {});
  let s = await st();
  check(s.side === expectSide && !s.tossing, `開局後你執 ${expectSide}`, JSON.stringify(s));
  if (expectSide === "black") {
    await waitAiDone(1);
    s = await st();
    check(s.n === 1 && s.turn === "black", "電腦先 ⇒ 6 秒內走第一手、輪到你", JSON.stringify(s));
  } else {
    await page.waitForTimeout(600);
    s = await st();
    check(s.n === 0 && s.turn === "red", "你先 ⇒ 電腦沒有搶走", JSON.stringify(s));
  }
}

await page.goto(BASE + "?v=" + Date.now());
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.app, null, { timeout: 10000 });

// ① ② ③ 擲骰:你 6 點、電腦 1 點 ⇒ 你執紅
await pick("dice", [0.99, 0.01]);
await page.waitForSelector(GO, { timeout: 8000 }).catch(() => {});
let fm = await facesMatch();
check(fm.length === 2 && fm.every(([a, b]) => a === b), "🎲 骰面朝上 == 點數(你先那局)", JSON.stringify(fm));
const blocked = await page.evaluate(() => {
  const a = window.app; a.handleSquareClick(2, 1);
  return { tossing: a.tossing, selected: !!a.gameLogic.selectedPiece };
});
check(blocked.tossing && !blocked.selected, "擲骰期間棋盤不收點", JSON.stringify(blocked));
await goAndSettle("red");

// 「重新開局」(選著擲骰)⇒ 每局重擲:電腦 6、你 1 ⇒ 你執黑
await page.evaluate(() => { window.__rigRolls = [0.01, 0.99]; });
await page.evaluate(RIG);
await page.click("#newGameButton");
await page.waitForSelector(GO, { timeout: 8000 }).catch(() => {});
fm = await facesMatch();
check(fm.length === 2 && fm.every(([a, b]) => a === b), "🎲 重新開局也重擲、骰面 == 點數(電腦先那局)", JSON.stringify(fm));
await goAndSettle("black");

// ④ 執黑悔到開局 ⇒ 電腦重走第一手、輪到你
await page.click("#undoButton");
await page.waitForTimeout(200);
await waitAiDone(1);
let s = await st();
check(s.n === 1 && s.turn === "black" && !s.thinking, "執黑悔到開局 ⇒ 電腦重走第一手、輪到你(不卡住)", JSON.stringify(s));

// ⑤ 局號守門:固定執黑,電腦正在想的時候再按一次「重新開局」
await pick("black");
await page.evaluate(() => { const b = document.getElementById("newGameButton"); b.click(); b.click(); });
await page.waitForTimeout(300);
await waitAiDone(1);
await page.waitForTimeout(800);
s = await st();
check(s.n === 1 && s.turn === "black", "連按重新開局 ⇒ 新局只有電腦一手(舊局那手丟掉)", JSON.stringify(s) + " " + (await page.evaluate(() => window.app.gameLogic.moveLog.map((m) => m.side + ":" + m.key).join(" "))));

// ⑥ 擲硬幣
await pick("coin", [0.2]);
await page.waitForSelector(GO, { timeout: 8000 }).catch(() => {});
fm = await facesMatch();
check(fm.length === 1 && fm[0][0] === fm[0][1], "🪙 硬幣朝上那面 == 結果", JSON.stringify(fm));
const youFirst = await page.evaluate(() => /^你\s*先/.test(document.querySelector(".dt-ov .dt-msg")?.textContent || ""));
await goAndSettle(youFirst ? "red" : "black");

// ⑥b 浮層開著時用鍵盤按「重新開局」(浮層蓋得住滑鼠、蓋不住 Tab + Enter)⇒ 舊浮層要收掉,不能疊兩層
await pick("dice", [0.99, 0.01]);
await page.waitForSelector(GO, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => { window.__rigRolls = [0.99, 0.01]; });
await page.focus("#newGameButton");
await page.keyboard.press("Enter");
await page.waitForSelector(GO, { timeout: 8000 }).catch(() => {});
check((await page.locator(".dt-ov").count()) === 1, "擲骰中用鍵盤重新開局 ⇒ 只剩一層浮層", `浮層 ${await page.locator(".dt-ov").count()} 層`);
await page.locator(GO).first().click();
await page.waitForTimeout(300);
check((await page.locator(".dt-ov").count()) === 0 && (await st()).side === "red", "按開始後浮層全收、你執紅", `浮層 ${await page.locator(".dt-ov").count()} 層`);

// ⑦ 重新整理(選著擲骰)⇒ 開頁那局也擲
await pick("dice", []);
await page.waitForSelector(GO, { timeout: 8000 }).catch(() => {});
await page.locator(GO).click();
await page.reload();
await page.waitForFunction(() => !!window.app, null, { timeout: 10000 });
const bootToss = await page.waitForSelector(GO, { timeout: 8000 }).then(() => true).catch(() => false);
check(bootToss && (await st()).choice === "dice", "重新整理 ⇒ 選項還是擲骰、開頁那局也擲");
if (bootToss) await page.locator(GO).click();
await page.waitForSelector(".dt-ov", { state: "detached", timeout: 5000 }).catch(() => {});

// 📅 每日殘局不擲、一律執紅
const leftover = await page.evaluate(() => [...document.querySelectorAll(".dt-ov")].map((o) => o.textContent.slice(0, 60)));
check(leftover.length === 0, "開始之後畫面上沒有殘留的擲骰浮層", JSON.stringify(leftover));
await page.click("#dailyButton", { timeout: 3000 }).catch(() => {});
await page.waitForTimeout(800);
s = await st();
check((await page.locator(".dt-ov").count()) === 0 && s.side === "red" && !s.tossing, "📅 每日殘局 ⇒ 不擲、你執紅", JSON.stringify(s));

// ⑧
check(errs.length === 0, "整場零 pageerror / console error", errs.join(" | "));

await browser.close();
if (server) server.close();
for (const [c, name, d] of results) console.log(`${c} ${name}${d ? " — " + d : ""}`);
const red = results.filter((r) => r[0] === "🔴").length;
console.log(`\nsmoke-dice:${results.length - red} 綠 / ${red} 紅(${BASE})`);
process.exit(red ? 1 : 0);
