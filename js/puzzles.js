// js/puzzles.js - 📅 每日殘局題庫(N 手連將殺)
//
// 每天一組、全世界同一組:日期(台北時間 UTC+8 換日)→ FNV-1a → 題庫輪出。
// 不用 Math.random ⇒ 任何裝置、任何時刻開,同一天必同一組。
//
// ★ 2026-09-04 全部換掉。舊題庫的問題(使用者原話「太簡單了,一點難度都沒有」):
//   ① 16 題裡黑方**一顆攻擊子都沒有**(只有將+士+象)⇒ 完全沒有反擊,紅方怎麼走都會贏。
//   ② hint 直接把解法寫在題目上(「兩支炮疊在一條線上,前炮就是後炮的炮架!」)。
//   ③ 驗證條件只是「高級 AI 對打 120 步內贏 2/3 次」—— 那不叫難度,那叫「總會贏」。
//
// 現在:每一題都是**機器窮舉驗過的 N 手連將殺**
//   ・紅方每一手都必須將軍,不管黑方怎麼應,N 手內將死
//   ・黑方一定有反擊子(車/炮/馬),而且開局至少 6 步可應
//   ・剛好 N 手 —— N-1 手殺不掉(所以標的步數是真的)
//   ・hint 只說「幾手連將殺」這個規則,不說走哪一顆
//
// ★ 題庫不是手擺的,是 scripts 生成 + 求解器窮舉驗證。
//   daily-puzzle-kit 的鐵則:每日題是機器生的 ⇒ 可解性也要機器驗。
//   手擺棋局宣稱「這題三步殺」的直覺錯誤率,本輪實測就踩到:
//   人工擺的 4 個「戰術題」只有 2 個真的有殺,還有 1 個是「輪紅走而黑方已被將」的違規局面。
//
// 棋盤座標:row 0-4=紅方(下)、row 5-9=黑方(上);紅兵往 row 增加的方向走。

const DAILY_PUZZLES = [
  { id: "炮兵-2", name: "炮兵", mateIn: 2,
    hint: "2 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 2, 4], ["cannon", 3, 8], ["pawn", 7, 5]],
    black: [["king", 9, 5], ["rook", 1, 6], ["rook", 7, 2], ["cannon", 6, 0]] },

  { id: "雙車馬-2", name: "雙車馬", mateIn: 2,
    hint: "2 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 1, 5], ["knight", 9, 2], ["rook", 5, 1], ["rook", 5, 6]],
    black: [["king", 7, 4], ["elephant", 5, 2], ["cannon", 6, 8], ["rook", 7, 7], ["cannon", 0, 3]] },

  { id: "雙車-3", name: "雙車", mateIn: 3,
    hint: "3 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 2, 5], ["rook", 4, 1], ["rook", 9, 0]],
    black: [["king", 9, 3], ["elephant", 9, 2], ["cannon", 5, 7], ["cannon", 3, 8], ["rook", 1, 6]] },

  { id: "雙車馬-3", name: "雙車馬", mateIn: 3,
    hint: "3 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 0, 4], ["rook", 4, 1], ["rook", 4, 7], ["knight", 6, 3]],
    black: [["king", 9, 3], ["elephant", 5, 6], ["elephant", 9, 6], ["cannon", 7, 4], ["cannon", 2, 0]] },

  { id: "雙馬-3", name: "雙馬", mateIn: 3,
    hint: "3 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 0, 4], ["knight", 6, 6], ["knight", 8, 8]],
    black: [["king", 9, 5], ["elephant", 9, 6], ["rook", 3, 1], ["rook", 5, 0]] },

  { id: "雙車-3-2", name: "雙車", mateIn: 3,
    hint: "3 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 0, 4], ["rook", 3, 7], ["rook", 6, 7]],
    black: [["king", 9, 5], ["elephant", 7, 8], ["cannon", 2, 5], ["rook", 8, 0]] },

  { id: "車馬兵-3", name: "車馬兵", mateIn: 3,
    hint: "3 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 2, 3], ["pawn", 6, 8], ["knight", 7, 2], ["rook", 6, 6]],
    black: [["king", 7, 5], ["advisor", 9, 3], ["rook", 4, 7], ["rook", 0, 2]] },

  { id: "雙車馬-4", name: "雙車馬", mateIn: 4,
    hint: "4 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 0, 4], ["rook", 8, 0], ["rook", 4, 8], ["knight", 7, 4]],
    black: [["king", 7, 3], ["elephant", 7, 8], ["advisor", 9, 3], ["rook", 1, 2], ["rook", 6, 0], ["cannon", 4, 7]] },

  { id: "車雙馬-4", name: "車雙馬", mateIn: 4,
    hint: "4 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 0, 5], ["knight", 4, 2], ["knight", 6, 7], ["rook", 5, 2]],
    black: [["king", 8, 4], ["knight", 3, 2], ["rook", 6, 1], ["rook", 2, 3]] },

  { id: "雙車-4", name: "雙車", mateIn: 4,
    hint: "4 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 1, 5], ["rook", 5, 6], ["rook", 2, 8]],
    black: [["king", 8, 3], ["elephant", 9, 6], ["cannon", 6, 2], ["rook", 2, 3], ["knight", 8, 1]] },

  { id: "雙車炮-4", name: "雙車炮", mateIn: 4,
    hint: "4 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 1, 4], ["cannon", 3, 2], ["rook", 2, 6], ["rook", 3, 8]],
    black: [["king", 9, 3], ["advisor", 7, 3], ["cannon", 1, 7], ["cannon", 6, 0], ["rook", 2, 2]] },

  { id: "雙車炮-4-2", name: "雙車炮", mateIn: 4,
    hint: "4 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 0, 3], ["rook", 4, 6], ["cannon", 2, 8], ["rook", 5, 7]],
    black: [["king", 7, 4], ["advisor", 9, 3], ["cannon", 6, 5], ["cannon", 2, 4], ["knight", 4, 4]] },

  { id: "雙車-4-2", name: "雙車", mateIn: 4,
    hint: "4 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 2, 5], ["rook", 2, 1], ["rook", 3, 7]],
    black: [["king", 9, 3], ["elephant", 7, 4], ["elephant", 5, 6], ["rook", 0, 3], ["rook", 5, 0]] },

  { id: "雙車-5", name: "雙車", mateIn: 5,
    hint: "5 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 1, 4], ["rook", 4, 8], ["rook", 7, 0]],
    black: [["king", 9, 5], ["elephant", 9, 6], ["cannon", 2, 4], ["cannon", 0, 1]] },

  { id: "雙車-5-2", name: "雙車", mateIn: 5,
    hint: "5 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 1, 3], ["rook", 7, 0], ["rook", 7, 8]],
    black: [["king", 9, 4], ["rook", 8, 2], ["cannon", 4, 3]] },

  { id: "車馬兵-5", name: "車馬兵", mateIn: 5,
    hint: "5 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 2, 5], ["pawn", 5, 3], ["knight", 5, 1], ["rook", 2, 2]],
    black: [["king", 8, 4], ["cannon", 4, 0], ["rook", 6, 3]] },

  { id: "雙車馬-5", name: "雙車馬", mateIn: 5,
    hint: "5 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 2, 4], ["knight", 6, 3], ["rook", 6, 0], ["rook", 7, 6]],
    black: [["king", 8, 3], ["elephant", 7, 4], ["rook", 4, 5], ["cannon", 8, 1]] },

  { id: "車馬-5", name: "車馬", mateIn: 5,
    hint: "5 手連將殺:每一手都要將軍,黑方怎麼應都躲不掉。",
    red: [["king", 1, 4], ["knight", 7, 2], ["rook", 8, 1]],
    black: [["king", 9, 5], ["elephant", 7, 8], ["knight", 4, 6], ["knight", 1, 7], ["rook", 6, 8]] },
];

// 台北時間(UTC+8)的日期——「全世界同一題」需要一條固定的換日線(與 billiards3d 撞11 同式)
function dailyPuzzleKey(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 每天出幾題(一組)。★ 5 題=一次坐下來解得完、又有「今天全解」的成就感(0831 使用者點名)。
const DAILY_SET_SIZE = 5;

// FNV-1a:日期字串 → 32 位種子(決定性,不用 Math.random)
function dailySeed(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 單題版(舊介面;=今天那一組的第一題) */
function puzzleForDate(key) {
  const set = puzzlesForDate(key, 1);
  return { key, index: set.indexes[0], puzzle: set.puzzles[0] };
}

/* ★ 每日一組(0831 使用者點名「不要只有 1 題」):
     決定性 Fisher-Yates 抽 count 題**不重複**,再依「紅方子力數」由少到多排
     ⇒ 今天全世界同一組同一順序。★ 象棋沒有 mateIn(江湖殘局不標步數),
     用「紅方棋子數」當難易近似:子少=手段少=通常更難?反過來——
     子多要協調更複雜,但子少更吃精算 ⇒ 這裡取**子多先出**(手段多、好上手),
     真正的難度排序留給題庫作者用 order 欄位覆寫(沒給就照這條)。 */
function puzzlesForDate(key, count = DAILY_SET_SIZE) {
  const n = Math.max(1, Math.min(count | 0 || 1, DAILY_PUZZLES.length));
  const rng = mulberry32(dailySeed(key));
  const pool = DAILY_PUZZLES.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const rank = (i) => {
    const p = DAILY_PUZZLES[i];
    return Number.isFinite(p.order) ? p.order : -p.red.length;   // 子多先出;order 可覆寫
  };
  const indexes = pool.slice(0, n).sort((a, b) => rank(a) - rank(b) || a - b);
  return { key, indexes, puzzles: indexes.map((i) => DAILY_PUZZLES[i]) };
}

// 題目 → 10×9 棋盤(名字照紅黑習慣:相/象、仕/士、帥/將、兵/卒)
function buildPuzzleBoard(puzzle) {
  const NAMES = {
    red: { rook: "車", knight: "馬", elephant: "相", advisor: "仕", king: "帥", cannon: "炮", pawn: "兵" },
    black: { rook: "車", knight: "馬", elephant: "象", advisor: "士", king: "將", cannon: "炮", pawn: "卒" },
  };
  const board = Array(10).fill(null).map(() => Array(9).fill(null));
  for (const color of ["red", "black"]) {
    for (const [type, r, c] of puzzle[color]) {
      board[r][c] = { type, color, name: NAMES[color][type] };
    }
  }
  return board;
}
