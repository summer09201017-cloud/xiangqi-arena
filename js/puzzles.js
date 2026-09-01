// js/puzzles.js - 📅 每日殘局題庫(江湖殘局風)
//
// 每天一題、全世界同一題:日期(台北時間 UTC+8 換日)→ FNV-1a → 題庫輪出。
// 不用 Math.random ⇒ 任何裝置、任何時刻開,同一天必同一題(零後端)。
//
// ★ 題庫紀律(2026-08-31 立):
//   ① 每一題都要過機器驗證(test/daily.mjs):紅方 AI(高級)對黑方 AI(高級)
//      實打,紅方要在步數上限內贏——「解得動」不靠人看。
//   ② 兩王不可同列空檔照面(這個引擎的飛將=王可直接飛吃,照面=一步被秒)。
//   ③ 這些是「江湖殘局風」的原創擺題(紅先勝、少子、看得懂)。
//      正宗古譜殘局(七星聚會、蚯蚓降龍那些)多為紅先和、解法幾十步,
//      孩子玩不動、也**不可憑記憶亂擺冒名**——之後要收錄需逐題查證棋譜。
//
// 棋盤座標:row 0-4=紅方(下)、row 5-9=黑方(上);紅兵往 row 增加的方向走。

const DAILY_PUZZLES = [
  { id: "double-rooks", name: "雙車錯", hint: "兩支車輪流將軍,把老將趕出九宮!",
    red: [["king", 0, 3], ["rook", 7, 0], ["rook", 6, 8]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 9, 5]] },

  { id: "rook-knight", name: "車馬冷著", hint: "馬控將門,車來收官——別讓馬腳被絆住!",
    red: [["king", 0, 3], ["rook", 6, 1], ["knight", 5, 4]],
    black: [["king", 9, 4], ["advisor", 9, 5], ["elephant", 9, 6]] },

  { id: "rook-cannon", name: "車炮逼宮", hint: "炮要隔一顆子才吃得到——找好炮架!",
    red: [["king", 0, 3], ["rook", 5, 0], ["cannon", 5, 4], ["pawn", 6, 4]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 8, 4]] },

  { id: "three-pawns", name: "三兵逼宮", hint: "過了河的兵能左右走——三兄弟一起擠進九宮!",
    red: [["king", 0, 3], ["pawn", 7, 3], ["pawn", 7, 4], ["pawn", 7, 5], ["rook", 4, 8]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 9, 5]] },

  { id: "double-cannons", name: "重炮連環", hint: "兩支炮疊在一條線上,前炮就是後炮的炮架!",
    red: [["king", 0, 3], ["cannon", 5, 4], ["cannon", 3, 4], ["pawn", 6, 0]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["elephant", 9, 6]] },

  { id: "rook-two-pawns", name: "車雙兵", hint: "兵開路、車包抄——小兵到了底線也能立大功!",
    red: [["king", 0, 3], ["rook", 4, 4], ["pawn", 6, 2], ["pawn", 6, 6]],
    black: [["king", 8, 4], ["advisor", 9, 3], ["advisor", 9, 5], ["elephant", 9, 2]] },

  { id: "knight-cannon", name: "馬炮爭先", hint: "馬跳將門、炮鎮中路——兩件武器輪流發難!",
    red: [["king", 0, 3], ["knight", 6, 2], ["cannon", 4, 4], ["pawn", 6, 4]],
    black: [["king", 9, 4], ["advisor", 9, 5], ["elephant", 5, 2]] },

  { id: "lone-rook", name: "單車擒王", hint: "只有一支車也夠——先吃士,再把老將逼到角落!",
    red: [["king", 0, 3], ["rook", 7, 7], ["pawn", 5, 3]],
    black: [["king", 9, 4], ["advisor", 9, 3]] },

  { id: "deep-pawns", name: "老兵搜山", hint: "貼著底線的兵最兇——配合車把九宮拆了!",
    red: [["king", 0, 3], ["pawn", 8, 3], ["pawn", 8, 5], ["rook", 5, 0]],
    black: [["king", 9, 4], ["elephant", 9, 6], ["elephant", 5, 6]] },

  { id: "cannon-pawn", name: "炮兵聯手", hint: "兵當炮架直轟中路——黑將躲哪裡都有下一發!",
    red: [["king", 0, 3], ["cannon", 6, 4], ["pawn", 7, 4], ["pawn", 5, 7]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 9, 5]] },

  { id: "full-house", name: "車馬炮會師", hint: "三軍到齊!別急著吃子,先想哪一步是將軍。",
    red: [["king", 0, 3], ["rook", 5, 1], ["knight", 4, 5], ["cannon", 3, 0]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 9, 5], ["elephant", 9, 2], ["elephant", 9, 6]] },

  { id: "twin-knights", name: "雙馬飲泉", hint: "兩匹馬互相掩護往九宮跳——小心別絆到自己!",
    red: [["king", 0, 3], ["knight", 6, 3], ["knight", 6, 5], ["pawn", 6, 7], ["rook", 3, 0]],
    black: [["king", 9, 4], ["advisor", 8, 4], ["elephant", 9, 2]] },

  { id: "center-cannon", name: "中炮鎖喉", hint: "炮鎮中路釘住老將,車從旁邊繞進去!",
    red: [["king", 0, 3], ["cannon", 4, 4], ["pawn", 6, 4], ["rook", 6, 8]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 9, 5], ["elephant", 9, 6]] },

  { id: "river-pawns", name: "過河卒建功", hint: "兩個過河兵一左一右,車在後面壓陣!",
    red: [["king", 0, 4], ["pawn", 7, 2], ["pawn", 6, 4], ["rook", 3, 8]],
    black: [["king", 9, 3], ["advisor", 8, 4], ["elephant", 7, 4]] },

  { id: "moon-scoop", name: "海底撈月", hint: "車沉底線、炮從後面照——老將無處可逃!",
    red: [["king", 0, 3], ["rook", 5, 5], ["cannon", 1, 4], ["pawn", 5, 2]],
    black: [["king", 9, 4], ["advisor", 9, 5]] },

  { id: "armor-off", name: "霸王卸甲", hint: "先拆士象、再擒老將——一件一件來,不急。",
    red: [["king", 1, 3], ["rook", 8, 0], ["cannon", 6, 6], ["pawn", 5, 4]],
    black: [["king", 9, 4], ["advisor", 9, 3], ["advisor", 9, 5], ["elephant", 9, 6]] },
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
