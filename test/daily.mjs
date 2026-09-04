/* 🔬 📅 每日殘局(江湖殘局風)驗算。
   跑法:node test/daily.mjs   (只驗規則/AI/題庫,零 DOM 零 three.js)

   釘五件:
     ①題庫擺位合法:座標在盤內、不疊子、士象在自己的合法點、雙方都有王、
       ★ 兩王不同列空檔照面(這個引擎的飛將=王可直接飛吃,照面=一步被秒)
     ②決定性:同一天必同一題、UTC+8 換日線、未來 400 天都取得到題
     ③★ 每一題機器驗「解得動」:紅 AI(高級)對黑 AI(高級)實打,
       3 次嘗試至少 2 次在步數上限內贏——無解題不能靠人看
     ④紅方先手就有合法走法(不會一開局就卡死)
     ⑤黑方第一步不能直接吃掉紅帥(擺位不送頭)

   ★ 這個 repo 的 js/ 是瀏覽器全域 class(不是 module)——用 new Function
     把純邏輯三支+題庫串起來取回類別,不動產品程式。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8");
const factory = new Function(
  [src("js/pieces.js"), src("js/gameLogic.js"), src("js/ai.js"), src("js/puzzles.js")].join("\n")
  + "\nreturn { PiecesRules, GameLogic, ChessAI, DAILY_PUZZLES, DAILY_SET_SIZE, dailyPuzzleKey, puzzleForDate, puzzlesForDate, buildPuzzleBoard };",
);
const { PiecesRules, GameLogic, ChessAI, DAILY_PUZZLES, DAILY_SET_SIZE, dailyPuzzleKey, puzzleForDate, puzzlesForDate, buildPuzzleBoard } = factory();

let pass = 0, fail = 0;
const ok = (label, cond, note = "") => {
  if (cond) { pass++; console.log("  🟢 " + label); }
  else { fail++; console.log("  🔴 " + label + (note ? "  → " + String(note).slice(0, 240) : "")); }
};
const section = (s) => console.log("\n── " + s + " ──");

/* ══ ① 擺位合法 ══ */
section("① 題庫擺位合法(" + DAILY_PUZZLES.length + " 題逐題驗)");
{
  const advisorSpots = {
    red: new Set(["0,3", "0,5", "1,4", "2,3", "2,5"]),
    black: new Set(["9,3", "9,5", "8,4", "7,3", "7,5"]),
  };
  const elephantSpots = {
    red: new Set(["0,2", "0,6", "2,0", "2,4", "2,8", "4,2", "4,6"]),
    black: new Set(["9,2", "9,6", "7,0", "7,4", "7,8", "5,2", "5,6"]),
  };
  for (const p of DAILY_PUZZLES) {
    const why = [];
    const seen = new Set();
    let redKing = null, blackKing = null;
    for (const color of ["red", "black"]) {
      for (const [type, r, c] of p[color]) {
        if (r < 0 || r > 9 || c < 0 || c > 8) why.push(`${type} 出盤 (${r},${c})`);
        const k = r + "," + c;
        if (seen.has(k)) why.push(`疊子 (${r},${c})`);
        seen.add(k);
        if (type === "king") {
          if (!PiecesRules.isInPalace(color, r, c)) why.push(`${color} 王不在九宮 (${r},${c})`);
          if (color === "red") redKing = { r, c }; else blackKing = { r, c };
        }
        if (type === "advisor" && !advisorSpots[color].has(k)) why.push(`${color} 士位非法 (${r},${c})`);
        if (type === "elephant" && !elephantSpots[color].has(k)) why.push(`${color} 象位非法 (${r},${c})`);
        if (type === "pawn") {
          const crossed = color === "red" ? r >= 5 : r <= 4;
          if (!crossed && color === "red" && r < 3) why.push(`紅兵位太後 (${r},${c})`);
        }
      }
    }
    if (!redKing || !blackKing) why.push("缺王");
    if (redKing && blackKing && redKing.c === blackKing.c) {
      const board = buildPuzzleBoard(p);
      if (PiecesRules.countPiecesBetween(board, redKing.r, redKing.c, blackKing.r, blackKing.c) === 0) {
        why.push("★ 兩王同列空檔照面(開局就會被飛將秒)");
      }
    }
    ok(`「${p.name}」擺位合法`, why.length === 0, why.join("/"));
  }
}

/* ══ ② 決定性 ══ */
section("② 決定性與換日線");
{
  const t = Date.UTC(2026, 7, 31, 15, 59);
  ok("UTC 15:59 仍是台北 8/31", dailyPuzzleKey(t) === "2026-08-31", dailyPuzzleKey(t));
  ok("UTC 16:00 換成台北 9/01", dailyPuzzleKey(t + 60000) === "2026-09-01");
  const a = puzzleForDate("2026-08-31");
  const b = puzzleForDate("2026-08-31");
  ok("同一天必同一題", a.index === b.index && a.puzzle.id === b.puzzle.id);
  let allOk = true;
  const hit = new Set();
  for (let i = 0; i < 400; i++) {
    const r = puzzleForDate(dailyPuzzleKey(Date.UTC(2026, 7, 31) + i * 86400000));
    if (!r.puzzle || !r.puzzle.red) allOk = false;
    hit.add(r.index);
  }
  ok("未來 400 天每天都取得到題", allOk);
  ok("題庫輪得開(400 天內每一題都出過場)", hit.size === DAILY_PUZZLES.length, `出過 ${hit.size}/${DAILY_PUZZLES.length}`);
}

/* ══ ②b 每日一組多題(0831 使用者點名「不要只有 1 題」)══ */
section("②b 每日一組:" + DAILY_SET_SIZE + " 題、決定性、不重複、有固定順序");
{
  const a = puzzlesForDate("2026-08-31");
  const b = puzzlesForDate("2026-08-31");
  ok("一組 " + DAILY_SET_SIZE + " 題", a.puzzles.length === DAILY_SET_SIZE, String(a.puzzles.length));
  ok("★ 同一天同一組、同一順序(全世界一致)", JSON.stringify(a.indexes) === JSON.stringify(b.indexes), JSON.stringify(a.indexes));
  ok("同一組內不重複", new Set(a.indexes).size === a.indexes.length);
  const c = puzzlesForDate("2026-09-01");
  ok("隔天換一組", JSON.stringify(a.indexes) !== JSON.stringify(c.indexes), JSON.stringify(c.indexes));
  const big = puzzlesForDate("2026-08-31", DAILY_PUZZLES.length + 99);
  ok("要求超過題庫時夾住且不重複", big.puzzles.length === DAILY_PUZZLES.length
    && new Set(big.indexes).size === DAILY_PUZZLES.length, String(big.puzzles.length));
  ok("舊介面 puzzleForDate = 這一組的第一題",
    puzzleForDate("2026-08-31").puzzle.id === puzzlesForDate("2026-08-31", 1).puzzles[0].id);
  const seen = new Set();
  let allFull = true;
  for (let i = 0; i < 400; i += 1) {
    const s = puzzlesForDate(dailyPuzzleKey(Date.UTC(2026, 7, 31) + i * 86400000));
    if (s.puzzles.length !== DAILY_SET_SIZE) allFull = false;
    s.indexes.forEach((x) => seen.add(x));
  }
  ok("400 天每天都湊得出完整一組", allFull);
  ok("400 天內題庫每一題都出過場", seen.size === DAILY_PUZZLES.length, `${seen.size}/${DAILY_PUZZLES.length}`);
}

/* ══ ③ 每題「N 手連將殺」窮舉驗證(解得動的機器證據)══
   ★ 2026-09-04 換掉舊驗法。舊的是「紅 AI(高級)對打 3 試 ≥2 勝、120 步內」——
     那是**抽樣**,只證明「總會贏」,不證明難度,而且黑方原本沒有攻擊子,怎麼打都贏。
     而且新引擎高級檔一手要 1.1 秒,18 題 ×3 試 ×120 步 = 要跑好幾小時。
   ⇒ 改成窮舉求解:紅方每一手都將軍,不管黑方怎麼應,mateIn 手內將死。
     這是**保證**不是抽樣,而且快(全部 18 題數秒內跑完)。 */

function otherSide(c) { return c === "red" ? "black" : "red"; }
function makeMateSolver(ai) {
  function checkingMoves(board, atk) {
    const out = [];
    for (const m of ai.getAllLegalMoves(board, atk)) {
      const cap = ai.makeSimulatedMove(board, m);
      const gives = ai.isInCheck(board, otherSide(atk));
      const dead = ai.getAllLegalMoves(board, otherSide(atk)).length === 0;
      ai.undoSimulatedMove(board, m, cap);
      if (gives || dead) out.push(m);
    }
    return out;
  }
  function mateIn(board, atk, n) {
    if (n <= 0) return null;
    for (const m of checkingMoves(board, atk)) {
      const cap = ai.makeSimulatedMove(board, m);
      const replies = ai.getAllLegalMoves(board, otherSide(atk));
      let good = false;
      if (replies.length === 0) good = true;
      else if (n > 1) {
        good = true;
        for (const r of replies) {
          const c2 = ai.makeSimulatedMove(board, r);
          if (!mateIn(board, atk, n - 1)) good = false;
          ai.undoSimulatedMove(board, r, c2);
          if (!good) break;
        }
      }
      ai.undoSimulatedMove(board, m, cap);
      if (good) return m;
    }
    return null;
  }
  return mateIn;
}

section("③ 每題窮舉驗「N 手連將殺」(紅先,黑方怎麼應都逃不掉)");
{
  const ai = new ChessAI();
  const mateIn = makeMateSolver(ai);
  for (const p of DAILY_PUZZLES) {
    const board = buildPuzzleBoard(p);
    const t0 = Date.now();
    const hit = mateIn(board, "red", p.mateIn);
    const shorter = p.mateIn > 1 ? mateIn(board, "red", p.mateIn - 1) : null;
    ok(`「${p.name}」${p.mateIn} 手連將殺成立(${Date.now() - t0}ms)`, !!hit);
    ok(`「${p.name}」剛好 ${p.mateIn} 手(${p.mateIn - 1} 手殺不掉)`, !shorter,
       shorter && JSON.stringify(shorter));
  }
}

section("③-b 題目本身的難度前提(舊題庫就是敗在這裡)");
{
  const ai = new ChessAI();
  for (const p of DAILY_PUZZLES) {
    const board = buildPuzzleBoard(p);
    const atk = p.black.filter(([t]) => t === "rook" || t === "cannon" || t === "knight");
    ok(`「${p.name}」黑方有反擊子(${atk.length} 顆)`, atk.length > 0);
    const blk = ai.getAllLegalMoves(board, "black").length;
    ok(`「${p.name}」黑方開局 ${blk} 步可應(要 ≥6)`, blk >= 6);
    ok(`「${p.name}」hint 不洩解法(只講規則)`,
       typeof p.hint === "string" && p.hint.indexOf("手連將殺") >= 0);
    ok(`「${p.name}」紅方開局沒有被將`, !ai.isInCheck(board, "red"));
    ok(`「${p.name}」黑方開局沒有被將(不是一開始就在將軍中)`, !ai.isInCheck(board, "black"));
  }
}

/* ══ ④⑤ 開局理智 ══ */
section("④⑤ 開局理智:紅有步可走、黑第一步吃不到紅帥");
{
  const ai = new ChessAI();
  for (const p of DAILY_PUZZLES) {
    const board = buildPuzzleBoard(p);
    const redMoves = ai.getAllLegalMoves(board, "red");
    ok(`「${p.name}」紅方開局有 ${redMoves.length} 步可走`, redMoves.length > 0);
    const blackMoves = ai.getAllLegalMoves(board, "black");
    const kill = blackMoves.find((m) => {
      const t = board[m.to.row][m.to.col];
      return t && t.type === "king" && t.color === "red";
    });
    ok(`「${p.name}」黑第一步吃不到紅帥(擺位不送頭)`, !kill, kill && JSON.stringify(kill));
  }
}

/* ══ ⑥ 💡 AI 提示:提示出來的那一手,玩家一定點得動 ══
   app.js 的 showHint 借 ai.calculateBestMove 當提示,而 ai.js 的走法產生器與 gameLogic 是兩支程式碼
   ⇒ 它產出的走法**不保證**過得了
   gameLogic.isValidMove(玩家點擊真正會走的那條路)。
   一旦分岔,症狀是「提示叫我走這步,但棋子點不動」——遊戲看起來壞了,而使用者是對的。
   ⇒ 這一段就是釘死那條分岔:每一題都真的跑一次紅方提示,逐手驗合法。
   (showHint 本體需要 DOM+three,這裡驗的是它唯一會出錯的那個環節。) */
section("⑥ 💡 AI 提示:每一題的建議手都通得過真正的規則");
{
  const ai = new ChessAI();
  for (const p of DAILY_PUZZLES) {
    const gl = new GameLogic();
    gl.initGame(buildPuzzleBoard(p));
    const mv = ai.calculateBestMove(gl.getBoardState(), "red", "hard");
    ok(`「${p.name}」提示給得出一手`, !!mv);
    if (!mv) continue;
    const legal = gl.isValidMove(mv.from.row, mv.from.col, mv.to.row, mv.to.col);
    ok(`「${p.name}」提示那一手玩家點得動`, legal,
       `${JSON.stringify(mv.from)}→${JSON.stringify(mv.to)}`);
    const piece = gl.getBoardState()[mv.from.row][mv.from.col];
    ok(`「${p.name}」提示動的是紅方自己的棋`, !!piece && piece.color === "red");
  }
}

/* ⑥b 快取鑰匙:同一個局面必須算出同一把鑰匙、換一顆子就要不同。
   showHint 靠它做到「同局面按幾次都回同一手」(calculateBestMove 內部有洗牌,
   不快取的話同分的兩手會輪流跳,看起來像跳針)。 */
section("⑥b 💡 提示快取的鑰匙認得出局面");
{
  /* ★ 直接用引擎自己的 gameLogic.positionKey() ——
     對局場的 💡 提示快取與長將規則**共用同一把鑰匙**,
     測試另抄一份的話,哪天引擎改了算法,測試還是綠的而產品已經壞了
     (這正是本輪在別處一再避免的「兩份真相」)。 */
  const keyOf = (gl) => gl.positionKey();
  const _unusedLegacyKeyOf = (gl) => {         // 舊版(3D-Xiangqi)的算法,留著對照
    const b = gl.getBoardState();
    let s = gl.currentPlayer + "|";
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const q = b[r][c];
      s += q ? q.color[0] + q.type + "," : ".";
    }
    return s;
  };
  const a = new GameLogic(); a.initGame(buildPuzzleBoard(DAILY_PUZZLES[0]));
  const b = new GameLogic(); b.initGame(buildPuzzleBoard(DAILY_PUZZLES[0]));
  ok("同一題兩份盤面 ⇒ 同一把鑰匙", keyOf(a) === keyOf(b));
  const c = new GameLogic(); c.initGame(buildPuzzleBoard(DAILY_PUZZLES[1]));
  ok("不同題 ⇒ 不同鑰匙", keyOf(a) !== keyOf(c));
  // 走一步之後鑰匙一定要變(否則走完還吐上一手的提示)
  const mv = new ChessAI().calculateBestMove(a.getBoardState(), "red", "easy");
  if (mv) {
    const before = keyOf(a);
    a.executeMove(mv.from.row, mv.from.col, mv.to.row, mv.to.col);
    ok("走一步之後鑰匙就變了", keyOf(a) !== before);
  }
  // king / knight 首字都是 k:鑰匙必須用完整 type,否則兩者混為一談
  const hasKnight = DAILY_PUZZLES.some((p) => p.red.some((x) => x[0] === "knight"));
  if (hasKnight) {
    const kp = DAILY_PUZZLES.find((p) => p.red.some((x) => x[0] === "knight"));
    const g = new GameLogic(); g.initGame(buildPuzzleBoard(kp));
    ok("有馬的題目:鑰匙裡 king 與 knight 分得開", keyOf(g).includes("knight,") && keyOf(g).includes("king,"));
  }
}

console.log(`\n🔬 daily:${pass} 過 / ${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
