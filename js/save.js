// js/save.js - 存檔 / 讀檔(對局場招牌功能之一)
//
// ⚠⚠ 施工單 §4.3 的坑,五款每日殘局**全部**踩過:
//    存檔格式若是「從標準開局重播棋譜」,自訂起手的局面(=每日殘局)存下去、讀回來
//    會**靜默重建成另一個局面** —— 不報錯、就是壞檔。
// ⇒ 這一版刻意存**盤面快照**不是棋譜:整張 10×9 直接寫下來,讀回來就是那張盤,
//   不需要從開局重播,所以殘局也存得起來。
//   即使如此,每日殘局仍然**不進存檔**(見 app.js 的 saveGame):
//   殘局是「今天這一題」,存起來明天讀出來會跟當天的題目打架,語意上就不該存。
//
// ★ 存檔鍵是新的 `xiangqi-arena-save-v1`,**不沿用**舊站的 `xiangqi-3d-save-v3`:
//   舊站是另一支引擎(WXF 字串式棋譜),格式對不上;沿用同一個鍵去讀它,
//   拿到的會是一包看得懂欄位、卻擺不出正確盤面的資料 —— 那比「沒有存檔」更糟。
//   舊鍵一律不動、不刪(使用者換回舊版時他的存檔還在)。

/* backup-chain:ok —— 這一個鍵刻意**不接**匯出/匯入備份鏈,理由寫清楚免得下一手又問:
   ① 這站沒有、也不打算有「匯出/匯入」功能(它是一個下棋的頁面,不是帳本);
   ② 存的是「一盤下到一半的棋」,是裝置層的暫存,不是使用者一筆一筆教出來的資料
      —— 掉了就是重下一盤,不會有「怎麼分類又全錯了」那種查不出來的損失;
   ③ 真的哪天加了備份功能,這個鍵要一起進去(那時把這行標記拿掉)。
   守門 #42 的本意是擋「使用者教出來的資料靜靜歸零」,這裡兩者都不成立。 */
const SAVE_KEY = 'xiangqi-arena-save-v1';
const SAVE_VERSION = 1;

const SaveManager = {
    /* 存:整張盤面 + 輪到誰 + 設定。
       ⚠ 全程 try/catch —— Safari 私密模式下 localStorage 一碰就丟例外,
         沒包的話使用者按「存檔」會整個頁面當掉(而他只是想存個檔)。 */
    save(gameLogic, settings) {
        try {
            const payload = {
                v: SAVE_VERSION,
                savedAt: new Date().toISOString(),
                board: gameLogic.getBoardState().map((row) =>
                    row.map((cell) => (cell ? { type: cell.type, color: cell.color, name: cell.name } : null))),
                currentPlayer: gameLogic.currentPlayer,
                moveCount: gameLogic.moveLog.length,
                settings: {
                    difficulty: settings.difficulty,
                    openingBook: settings.openingBook,
                    humanSide: settings.humanSide,
                    viewMode: settings.viewMode,
                },
            };
            localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
            return { ok: true };
        } catch (error) {
            console.error('[save] 寫入失敗:', error);
            return { ok: false, reason: 'write' };
        }
    },

    // 讀:回三態 —— 有檔 / 沒檔 / 檔壞了。呼叫端要照三態講不同的話。
    load() {
        let raw = null;
        try {
            raw = localStorage.getItem(SAVE_KEY);
        } catch (error) {
            console.error('[save] 讀取失敗:', error);
            return { ok: false, reason: 'read' };
        }
        if (!raw) return { ok: false, reason: 'empty' };

        try {
            const data = JSON.parse(raw);
            // 形狀驗證:壞檔要當壞檔講,不要硬塞給引擎(硬塞的症狀是滿盤空白,更難查)
            if (!data || !Array.isArray(data.board) || data.board.length !== 10) {
                return { ok: false, reason: 'corrupt' };
            }
            if (data.board.some((row) => !Array.isArray(row) || row.length !== 9)) {
                return { ok: false, reason: 'corrupt' };
            }
            return { ok: true, data };
        } catch (error) {
            console.error('[save] 解析失敗:', error);
            return { ok: false, reason: 'corrupt' };
        }
    },

    has() {
        try {
            return Boolean(localStorage.getItem(SAVE_KEY));
        } catch {
            return false;
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SaveManager, SAVE_KEY, SAVE_VERSION };
}
