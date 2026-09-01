// js/openings.js - 開局棋譜(對局場的招牌功能)
//
// 線上舊版(無源碼)有五種譜:全譜庫 / 中炮譜 / 飛相譜 / 起馬譜 / 仙人指路譜,
// 畫面上明講「AI 會在**開局前 15 手**優先參考所選棋譜」。這一版照同一個契約重寫。
//
// ★ 座標與 gameLogic 同一套:row 0~4 = 紅方(下)、row 5~9 = 黑方(上),col 0~8 由左至右。
//   紅兵往 row **增加**方向走。寫譜的時候拿 setupInitialBoard() 對一次,不要憑印象。
//
// ⚠⚠ 每日殘局**一律不吃譜**(施工單 §4.2):殘局的起手不是標準開局,
//    照譜走會把 AI 帶去走不存在的變化,題目當場壞掉。startDaily() 強制 'none' 並把選單鎖住。
//
// ★ 譜只是「優先參考」不是「照抄」:每一步都要先過 isAllowedMove 驗證,
//   驗不過就當作沒有這條譜、退回搜尋。譜是用來讓開局有變化與風格,不是綁架 AI。

const OPENING_BOOKS = {
    none: {
        label: '不載入任何開局譜',
        hint: '純搜尋',
        lines: [],
    },

    /* 中炮:黑方把炮擺到中路(col 4),最兇的一路。
       黑方在上(row 5~9),黑炮起手在 row 7。 */
    cannon: {
        label: '中炮譜',
        hint: '優先使用中炮系開局',
        lines: [
            [[7, 1, 7, 4], [9, 1, 7, 2], [9, 0, 8, 0], [8, 0, 8, 4]],   // 中炮 + 跳馬 + 出車
            [[7, 7, 7, 4], [9, 7, 7, 6], [9, 8, 8, 8], [8, 8, 8, 4]],   // 右中炮鏡像
            [[7, 1, 7, 4], [9, 7, 7, 6], [6, 2, 5, 2], [9, 1, 7, 2]],   // 中炮 + 兩頭蛇
        ],
    },

    /* 飛相(黑方稱飛象):穩健布局,先把象走到中線護住。 */
    elephant: {
        label: '飛相譜',
        hint: '優先使用飛相與穩健布局',
        lines: [
            [[9, 2, 7, 4], [9, 1, 7, 2], [6, 4, 5, 4], [9, 0, 8, 0]],
            [[9, 6, 7, 4], [9, 7, 7, 6], [6, 4, 5, 4], [9, 8, 8, 8]],
            // ⚠ 象飛到 [7][4] 之後,炮就不能再平中(自己的象佔著)——改走出車
            [[9, 2, 7, 4], [9, 1, 7, 2], [6, 2, 5, 2], [9, 0, 8, 0]],
        ],
    },

    /* 起馬:先跳馬搶位。 */
    knight: {
        label: '起馬譜',
        hint: '優先使用起馬與先手搶位',
        lines: [
            [[9, 1, 7, 2], [9, 7, 7, 6], [6, 2, 5, 2], [9, 0, 8, 0]],
            [[9, 7, 7, 6], [9, 1, 7, 2], [6, 6, 5, 6], [9, 8, 8, 8]],
            [[9, 1, 7, 2], [6, 2, 5, 2], [7, 1, 8, 1], [9, 0, 9, 1]],
        ],
    },

    /* 仙人指路:先挺兵(黑方是卒),試探性起手。
       黑卒在 row 6,往 row **減少**方向走。 */
    pawn: {
        label: '仙人指路譜',
        hint: '優先使用仙人指路與兵卒起手',
        lines: [
            /* ⚠ 炮要**先**平中再跳馬 —— 反過來的話馬落在 [7][2],
               炮從 [7][1] 平到 [7][4] 的路就被自己的馬堵死(隔子只能吃、不能走)。 */
            [[6, 2, 5, 2], [7, 1, 7, 4], [9, 1, 7, 2], [9, 0, 8, 0]],
            [[6, 6, 5, 6], [7, 7, 7, 4], [9, 7, 7, 6], [9, 8, 8, 8]],
            [[6, 4, 5, 4], [9, 2, 7, 4], [9, 1, 7, 2], [6, 2, 5, 2]],
        ],
    },
};

/* 全譜庫 = 把上面四種的線全部收進來(舊版畫面寫「自動混合所有開局系統」)。
   ⚠ 用計算的、不要再手抄一份 —— 手抄的第二份一定會跟上面漂移。 */
OPENING_BOOKS.all = {
    label: '全譜庫',
    hint: '自動混合所有開局系統',
    lines: ['cannon', 'elephant', 'knight', 'pawn'].flatMap((k) => OPENING_BOOKS[k].lines),
};

// AI 只在**開局前 15 手**參考譜(與舊版畫面文案一致)
const OPENING_BOOK_PLIES = 15;

/* 從譜裡挑下一步。
   @param bookKey   選到的譜
   @param moveLog   gameLogic.moveLog(用它的長度當「第幾手」)
   @param gameLogic 用來驗證譜上那一步在**當下這個盤面**真的走得動
   @return {from:{row,col}, to:{row,col}} 或 null(沒譜、超過 15 手、或譜上那步走不動)

   ★ 選線的方式:每一條線都從第 0 手開始比對 moveLog 裡**黑方自己**走過的步,
     完全吻合的線才算「還在這條譜上」。吻合的線可能不只一條 ⇒ 隨機挑一條,
     這樣同一個譜也會有變化(舊版文案說的「自動混合」)。 */
/* ⚠⚠ 施工單 §4.2 的**結構性**保證,別靠運氣。
   實測(test/rules.mjs ④):16 題殘局裡有 **7 題**的盤面剛好讓開局譜挑得出走法 ——
   也就是說「殘局起手不是標準開局,所以譜自然對不上」這個直覺是**錯的**。
   ⇒ 每日殘局要不吃譜,只能靠這裡把它強制掉,不能指望盤面湊不上。 */
function effectiveBook(selectedKey, isDaily) {
    return isDaily ? 'none' : selectedKey;
}

function pickOpeningMove(bookKey, moveLog, gameLogic, rng = Math.random) {
    const book = OPENING_BOOKS[bookKey];
    if (!book || !book.lines.length) return null;
    if (moveLog.length >= OPENING_BOOK_PLIES) return null;

    // 黑方(AI)自己走過的步,依序
    const mine = moveLog.filter((m) => m.side === 'black').map((m) => m.key);

    const candidates = [];
    for (const line of book.lines) {
        if (mine.length >= line.length) continue;
        let onLine = true;
        for (let i = 0; i < mine.length; i++) {
            const [fr, fc, tr, tc] = line[i];
            if (mine[i] !== `${fr},${fc}>${tr},${tc}`) { onLine = false; break; }
        }
        if (!onLine) continue;

        const [fr, fc, tr, tc] = line[mine.length];
        // 譜上那一步在真實盤面走不走得動?走不動就當這條譜不存在(退回搜尋)
        const piece = gameLogic.getBoardState()[fr][fc];
        if (!piece || piece.color !== 'black') continue;
        if (!gameLogic.isAllowedMove(fr, fc, tr, tc)) continue;
        candidates.push({ from: { row: fr, col: fc }, to: { row: tr, col: tc } });
    }

    if (!candidates.length) return null;
    return candidates[Math.floor(rng() * candidates.length)];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OPENING_BOOKS, OPENING_BOOK_PLIES, pickOpeningMove, effectiveBook };
}
