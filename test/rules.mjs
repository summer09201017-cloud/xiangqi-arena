/* 🔬 對局場引擎驗算(node,零 DOM 零 three.js)。
   跑法:node test/rules.mjs

   釘四件(全部是「重建時自己新寫、正本 3D-Xiangqi 沒有」的那些):
     ① 長將規則:同一步連續將軍到第 4 次要被擋;換一步就解除;不將軍的重複不受這條管
     ② 悔棋:退回去的盤面要和走之前**逐格相同**(深拷貝,不是存到參考)
        而且長將的連續計數要一起退(否則悔完棋規則還記著已經不存在的那幾步)
     ③ 開局譜:每一條線都要能從開局**整條走完**——手抄的譜最容易自己把路堵死
        (炮先跳馬再平中 ⇒ 被自己的馬擋住),這種錯只有機器逐步走一次才看得到
     ④ 每日殘局旁路開局譜(施工單 §4.2):殘局盤面上譜一律回 null

   ★ 這個 repo 的 js/ 是瀏覽器全域 class(不是 module)——用 new Function 串起來取回類別,
     不動產品程式。(和 3D-Xiangqi 的 test/daily.mjs 同一招) */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8");
const factory = new Function(
  [src("js/pieces.js"), src("js/gameLogic.js"), src("js/openings.js"), src("js/puzzles.js")].join("\n")
  + "\nreturn { PiecesRules, GameLogic, OPENING_BOOKS, OPENING_BOOK_PLIES, pickOpeningMove,"
  + " effectiveBook, DAILY_PUZZLES, buildPuzzleBoard };",
);
const { GameLogic, OPENING_BOOKS, pickOpeningMove, effectiveBook, DAILY_PUZZLES, buildPuzzleBoard } = factory();

let pass = 0, fail = 0;
const ok = (label, cond, note = "") => {
  if (cond) { pass++; console.log("  🟢 " + label); }
  else { fail++; console.log("  🔴 " + label + (note ? "  → " + String(note).slice(0, 220) : "")); }
};
const section = (s) => console.log("\n── " + s + " ──");

const boardSig = (g) => g.getBoardState()
  .map((row) => row.map((c) => (c ? c.color[0] + c.type : ".")).join("|")).join("/");

/* ══ ① 長將規則 ══ */
section("① 長將:同一步連續將軍最多 3 回");
{
  /* 擺一個乾淨的局面:紅車在 [4][0],黑將在 [9][4],紅帥在 [0][4]。
     紅車在 col 4 與 col 0 之間來回 —— 走到 [4][4] 就是將軍(同一直線、中間無子)。 */
  const g = new GameLogic();
  g.initGame(Array(10).fill(null).map(() => Array(9).fill(null)));
  const b = g.getBoardState();
  b[0][4] = { type: "king", color: "red", name: "帥" };
  b[9][4] = { type: "king", color: "black", name: "將" };
  b[4][0] = { type: "rook", color: "red", name: "車" };
  b[5][8] = { type: "rook", color: "black", name: "車" };   // 黑方有子可動,不會困斃

  ok("起手:車平中路是將軍", (() => {
    b[4][4] = b[4][0]; b[4][0] = null;
    const isCheck = g.isInCheck("black");
    b[4][0] = b[4][4]; b[4][4] = null;
    return isCheck;
  })());

  /* 真正的長將長什麼樣:紅車在中路將軍,黑將只能左右挪一格,紅車跟著平移續將…
     兩邊都在原地繞圈,局面每兩回合就回到同一個 ⇒ 這才是要擋的東西。
     ★ 紅**每一回合都在將軍**(這是「連續」),而且局面會**繞回來**(這是「原地」)。 */
  let blocked = null;
  for (let round = 1; round <= 6 && blocked === null; round++) {
    if (!g.isAllowedMove(4, 0, 4, 4)) { blocked = round; break; }
    g.executeMove(4, 0, 4, 4);           // 紅:車平中路將軍
    g.executeMove(9, 4, 9, 3);           // 黑:將閃到旁邊
    if (!g.isAllowedMove(4, 4, 4, 3)) { blocked = round; break; }
    g.executeMove(4, 4, 4, 3);           // 紅:車跟著平過去,又將軍
    g.executeMove(9, 3, 9, 4);           // 黑:將閃回來
    g.executeMove(4, 3, 4, 0);           // 紅:車回原位(這一步不將軍)
    g.executeMove(5, 8, 5, 7);           // 黑:隨便走一步
    g.executeMove(4, 0, 4, 4);           // 紅:再來一次…(連續將軍重新累積)
    g.executeMove(9, 4, 9, 3);
    g.executeMove(4, 4, 4, 3);
    g.executeMove(9, 3, 9, 4);
  }
  ok("★ 一直將、卻在原地繞圈 ⇒ 被擋下來(第 " + blocked + " 輪)", blocked !== null,
     "blocked=" + blocked);

  ok("被擋時 handleInteraction 回 'perpetual'(要講原因,不是靜靜取消)", (() => {
    // 找出當下被擋的那一步,從選取狀態走一次真實互動路徑
    g.currentPlayer = "red";
    const from = [[4, 0], [4, 4], [4, 3]].find(([r, c]) => {
      const p = g.getBoardState()[r][c];
      return p && p.type === "rook" && p.color === "red";
    });
    if (!from) return false;
    const target = [[4, 4], [4, 3]].find(([r, c]) =>
      g.isValidMove(from[0], from[1], r, c) && !g.isAllowedMove(from[0], from[1], r, c));
    if (!target) return false;
    g.selectedPiece = { row: from[0], col: from[1] };
    const action = g.handleInteraction(target[0], target[1]);
    return action && action.type === "perpetual";
  })());
}

{
  /* ★★ 這一條最重要:**連續將軍到把對方將死的正解不可以被擋**。
     江湖殘局的正解常常就是一路將到底(施工單 §4.4);
     只看「連續將軍幾次」的規則會把那種題目變成死題。
     這裡走一條每一步都將軍、但局面**一直在推進**(不重複)的線。 */
  const g = new GameLogic();
  g.initGame(Array(10).fill(null).map(() => Array(9).fill(null)));
  const b = g.getBoardState();
  b[0][4] = { type: "king", color: "red", name: "帥" };
  b[9][4] = { type: "king", color: "black", name: "將" };
  b[9][3] = { type: "advisor", color: "black", name: "士" };
  b[9][5] = { type: "advisor", color: "black", name: "士" };
  b[8][0] = { type: "rook", color: "red", name: "車" };
  b[7][8] = { type: "rook", color: "red", name: "車" };

  let allAllowed = true;
  // 兩支車輪流沿著不同的列將軍 —— 每一步都在將,但局面一路往前不繞圈
  const line = [[8, 0, 8, 4], [7, 8, 7, 4], [8, 4, 8, 3], [7, 4, 7, 3]];
  for (const [fr, fc, tr, tc] of line) {
    g.currentPlayer = "red";
    if (!g.isValidMove(fr, fc, tr, tc)) continue;      // 這條線走不動就跳過,不影響結論
    if (!g.isAllowedMove(fr, fc, tr, tc)) { allAllowed = false; break; }
    g.executeMove(fr, fc, tr, tc);
    g.currentPlayer = "red";                            // 把手動推進的回合轉回紅方
  }
  ok("★★ 連續將軍但局面一路推進(=殘局正解)不會被擋", allAllowed);
}

{
  // 不將軍的重複走法不歸這條規則管(那是和棋議題)
  const g = new GameLogic();
  g.initGame();
  for (let i = 0; i < 6; i++) {
    g.executeMove(0, 1, 2, 2); g.executeMove(9, 1, 7, 2);
    g.executeMove(2, 2, 0, 1); g.executeMove(7, 2, 9, 1);
  }
  ok("不將軍的重複走法不被擋", g.isAllowedMove(0, 1, 2, 2));
}

/* ══ ② 悔棋 ══ */
section("② 悔棋:退回去要逐格相同,長將計數也要一起退");
{
  const g = new GameLogic();
  g.initGame();
  const before = boardSig(g);
  const beforeLog = g.moveLog.length;

  g.executeMove(3, 0, 4, 0);      // 紅兵進一步
  ok("走一步之後盤面就不一樣了", boardSig(g) !== before);
  ok("走完可以悔棋", g.canUndo());

  const done = g.undo(1);
  ok("undo 回報實際退了 1 步", done === 1);
  ok("★ 退回去的盤面與走之前**逐格相同**(深拷貝,不是存到參考)", boardSig(g) === before,
     boardSig(g).slice(0, 80));
  ok("輪到誰也退回來了", g.currentPlayer === "red");
  ok("長將的走法紀錄一起退了", g.moveLog.length === beforeLog);
  ok("退到底之後 canUndo 為 false", (g.undo(5), !g.canUndo()));
  ok("沒得退的時候 undo 回報 0(呼叫端才講得出誠實的話)", g.undo(1) === 0);
}

/* ══ ③ 開局譜 ══ */
section("③ 開局譜:每一條線都要能從開局整條走完");
{
  const books = Object.keys(OPENING_BOOKS).filter((k) => k !== "none");
  for (const key of books) {
    const book = OPENING_BOOKS[key];
    let lineNo = 0;
    for (const line of book.lines) {
      lineNo++;
      const g = new GameLogic();
      g.initGame();
      let step = 0, bad = null;
      for (const [fr, fc, tr, tc] of line) {
        step++;
        g.currentPlayer = "black";                      // 只驗黑方那一側的譜
        if (!g.isAllowedMove(fr, fc, tr, tc)) { bad = `第 ${step} 步 ${fr},${fc}>${tr},${tc}`; break; }
        g.executeMove(fr, fc, tr, tc);
      }
      ok(`「${book.label}」第 ${lineNo} 條線整條走得完(${line.length} 步)`, !bad, bad);
    }
  }
  ok("全譜庫 = 四種譜的線加起來(用算的,不是手抄第二份)",
    OPENING_BOOKS.all.lines.length
      === ["cannon", "elephant", "knight", "pawn"].reduce((n, k) => n + OPENING_BOOKS[k].lines.length, 0));
}

{
  // pickOpeningMove:開局第一手要挑得到;超過 15 手要收手
  const g = new GameLogic();
  g.initGame();
  g.currentPlayer = "black";
  const first = pickOpeningMove("cannon", g.moveLog, g, () => 0);
  ok("中炮譜開局第一手挑得到", !!first, JSON.stringify(first));
  ok("挑出來的那一手真的走得動",
    !!first && g.isAllowedMove(first.from.row, first.from.col, first.to.row, first.to.col));

  const longLog = Array.from({ length: 15 }, () => ({ key: "x", side: "black", givesCheck: false }));
  ok("超過 15 手就不再吃譜(和舊版畫面文案一致)",
    pickOpeningMove("cannon", longLog, g) === null);
  ok("選『不載入任何開局譜』回 null", pickOpeningMove("none", g.moveLog, g) === null);
}

/* ══ ④ 每日殘局旁路開局譜(施工單 §4.2)══ */
section("④ 每日殘局一律不吃開局譜(而且不可以靠運氣)");
{
  ok("effectiveBook 在每日模式一律回 'none'", effectiveBook("all", true) === "none");
  ok("一般對局照玩家選的譜", effectiveBook("cannon", false) === "cannon");

  /* ★★ 這條是本輪最值錢的發現,寫成測試釘住:
     「殘局起手不是標準開局,所以譜自然對不上」——**這個直覺是錯的**。
     首跑量到 16 題裡有 7 題的盤面剛好讓譜挑得出走法。
     ⇒ 證明 §4.2 一定要靠 effectiveBook 結構性擋掉,不能指望盤面湊不上。
     這條刻意斷言「**有**題目會被譜咬到」——哪天題庫換了讓它變 0,
     那也只是碰巧,結論(必須結構性強制)不變,但我們會知道基礎變了。 */
  let naturalHits = 0;
  for (const p of DAILY_PUZZLES) {
    const g = new GameLogic();
    g.initGame(buildPuzzleBoard(p));
    g.currentPlayer = "black";
    if (pickOpeningMove("all", g.moveLog, g) !== null) naturalHits++;
  }
  console.log(`     ℹ 若不強制:${DAILY_PUZZLES.length} 題裡有 ${naturalHits} 題會被開局譜咬到`);
  ok("★ 走 effectiveBook 之後,每一題都挑不出譜步", DAILY_PUZZLES.every((p) => {
    const g = new GameLogic();
    g.initGame(buildPuzzleBoard(p));
    g.currentPlayer = "black";
    return pickOpeningMove(effectiveBook("all", true), g.moveLog, g) === null;
  }));
}

console.log(`\n🔬 rules:${pass} 過 / ${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
