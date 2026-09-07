// 🔬 💡 提示品質測試(2026-09-07):提示不建議「白做工的交換」
// 跑法:node test/hint.mjs
//
// 背景:使用者在 3D 幻影西洋棋退件「提示叫我吃、吃完又被別的子吃回,等於交換被吃」。
// 全棋類體檢後,本站的兩條經典病因其實 2026-09-04 重寫時就修掉了(PST 位置分 + quiescence),
// 所以這裡加的是第三條、四站統一的規矩:**吃子要比最好的安靜手多賺半個卒才推薦**
// (LEVELS.hint.tradeMargin;AI 對手不受這條約束)。
//
// ★ 這個 repo 的 js/ 是瀏覽器全域 class(不是 module)—— 沿用 test/daily.mjs 的 new Function 手法。
// ★ 裁判(refNet)自己走一遍吃子鏈,只用 getPseudoMoves / make / undo + 自己那份子力表,
//   不碰被測的 _captureGain / evaluateBoard / 門檻,才算得上獨立。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8");
const factory = new Function(
  [src("js/pieces.js"), src("js/gameLogic.js"), src("js/ai.js")].join("\n")
  + "\nreturn { PiecesRules, GameLogic, ChessAI };",
);
const { GameLogic, ChessAI } = factory();

let pass = 0, fail = 0;
const ok = (label, cond, note = "") => {
  if (cond) { pass++; console.log("  🟢 " + label); }
  else { fail++; console.log("  🔴 " + label + (note ? "  → " + String(note).slice(0, 240) : "")); }
};

const ai = new ChessAI();
const VAL = { king: 0, rook: 900, cannon: 440, knight: 420, advisor: 200, elephant: 200, pawn: 100 };
const show = (m) => `${m.from.row},${m.from.col}→${m.to.row},${m.to.col}`;

// ── 獨立裁判:只看子力、只走吃子,算到沒人想再吃(negamax,回傳 color 視角) ──
function refMaterial(board) {
  let score = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) continue;
      score += (p.color === "red" ? 1 : -1) * (VAL[p.type] || 0);
    }
  }
  return score;
}
function refQuiesce(board, alpha, beta, color, depth) {
  const sign = color === "red" ? 1 : -1;
  let best = sign * refMaterial(board);
  if (depth <= 0) return best;
  if (best >= beta) return best;
  if (best > alpha) alpha = best;

  const enemy = color === "red" ? "black" : "red";
  const caps = [];
  for (const m of ai.getPseudoMoves(board, color)) {
    const victim = board[m.to.row][m.to.col];
    if (!victim) continue;
    if (victim.type === "king") return 50000;
    caps.push(m);
  }
  if (!caps.length) return best;

  for (const m of caps) {
    const cap = ai.makeSimulatedMove(board, m);
    const sc = -refQuiesce(board, -beta, -alpha, enemy, depth - 1);
    ai.undoSimulatedMove(board, m, cap);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
/** 走了 move 之後,交換算到底,對走棋方的淨子力 */
function refNet(board, move, color) {
  const sign = color === "red" ? 1 : -1;
  const before = sign * refMaterial(board);
  const enemy = color === "red" ? "black" : "red";
  const cap = ai.makeSimulatedMove(board, move);
  const after = -refQuiesce(board, -Infinity, Infinity, enemy, 8);
  ai.undoSimulatedMove(board, move, cap);
  return after - before;
}
const isCapture = (board, m) => !!board[m.to.row][m.to.col];

console.log("── ① 門檻裝上了 ──");
ok("提示檔有 tradeMargin,而且是半個卒(50)", ai.LEVELS.hint.tradeMargin === 50, String(ai.LEVELS.hint.tradeMargin));
ok("三個對手檔都沒有這條(AI 該換就換)",
  !ai.LEVELS.easy.tradeMargin && !ai.LEVELS.medium.tradeMargin && !ai.LEVELS.hard.tradeMargin);

console.log("── ② 隨機中局 ×20:提示建議的吃子,交換算到底都要有賺 ──");
{
  let seed = 20260907;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  let checked = 0, captures = 0, bad = [], tMax = 0, tSum = 0;
  for (let g = 0; g < 20; g += 1) {
    const logic = new GameLogic();
    logic.initGame();
    const board = logic.getBoardState();
    let color = "red";
    const plies = 6 + Math.floor(rnd() * 16);
    let alive = true;
    for (let i = 0; i < plies; i += 1) {
      const moves = ai.getAllLegalMoves(board, color);
      if (!moves.length) { alive = false; break; }
      const m = moves[Math.floor(rnd() * moves.length)];
      ai.makeSimulatedMove(board, m);
      color = color === "red" ? "black" : "red";
    }
    if (!alive || !ai.findKing(board, "red") || !ai.findKing(board, "black")) continue;
    const moves = ai.getAllLegalMoves(board, color);
    if (!moves.length) continue;

    const t0 = Date.now();
    const hint = ai.calculateBestMove(board, color, "hint");
    const dt = Date.now() - t0; tSum += dt; tMax = Math.max(tMax, dt);
    if (!hint) continue;
    checked += 1;

    if (isCapture(board, hint)) {
      captures += 1;
      const net = refNet(board, hint, color);
      // 使用者的規矩:吃完被吃回、子力沒賺 ⇒ 不該建議
      if (net <= 0) bad.push(`${show(hint)} 淨 ${net}`);
    }
  }
  ok(`${checked} 個局面裡,${captures} 手建議吃子,每一手交換算到底都有賺`, bad.length === 0, bad.slice(0, 3).join(" | "));
  console.log(`  ⏱ 提示耗時:平均 ${Math.round(tSum / Math.max(checked, 1))}ms,最慢 ${tMax}ms`);
  ok("最慢的一手 < 3000ms(提示檔預算 1400ms + 挑手)", tMax < 3000, `${tMax}ms`);
}

console.log("── ③ 白吃不可以放過 + 同局面同一手 ──");
{
  /* 紅車 (0,0) 沿著第 0 路上去,可以白吃沒人保護的黑車 (5,0) ⇒ 提示必須推薦它。
     這一題是在守「門檻別把提示變得太保守,連白吃都不敢吃」。
     出題兩個坑(兩個都自己踩過,記下來):
       ⚠ 兩個王不可以排同一直線 —— 這支引擎的王會飛將,同線時「王吃王」才是正解;
       ⚠ 黑方不可以只剩光桿王 —— 車+帥對單王是必殺,引擎會(正確地)選必殺而不是吃車,
         題目就會紅在自己身上。所以黑方留了炮/馬/雙士,讓局面沒有速殺。 */
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[1][3] = { type: "king", color: "red" };
  board[0][0] = { type: "rook", color: "red" };
  board[9][4] = { type: "king", color: "black" };
  board[9][3] = { type: "advisor", color: "black" };
  board[9][5] = { type: "advisor", color: "black" };
  board[7][1] = { type: "cannon", color: "black" };
  board[7][7] = { type: "knight", color: "black" };
  board[5][0] = { type: "rook", color: "black" };
  const hint = ai.calculateBestMove(board, "red", "hint");
  ok(`沒人保護的車要白吃(${show(hint)})`, hint.to.row === 5 && hint.to.col === 0);

  const again = ai.calculateBestMove(board, "red", "hint");
  ok("提示零隨機:同局面兩次同一手", show(again) === show(hint), `${show(again)} vs ${show(hint)}`);
}

console.log(`\n🔬 hint:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
