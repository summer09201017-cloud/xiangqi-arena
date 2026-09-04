// js/gameLogic.js - 核心遊戲狀態與規則

class GameLogic {
    constructor() {
        this.board = [];
        this.currentPlayer = 'red'; // 'red' or 'black'
        this.selectedPiece = null;  // {row, col}
        this.isGameOver = false;
        this.winner = null;
        /* 對局場新增(3D-Xiangqi 那支沒有這兩樣):
           history = 悔棋用的整局快照堆;moveLog = 長將規則用的走法紀錄。 */
        this.history = [];
        this.moveLog = [];
    }

    // customBoard(選填):📅 每日殘局用——直接給一張擺好的 10×9 棋盤(buildPuzzleBoard 產),
    // 不給就照傳統開局擺。兩條路都是紅先。
    initGame(customBoard = null) {
        this.board = customBoard || Array(10).fill(null).map(() => Array(9).fill(null));
        this.currentPlayer = 'red';
        this.selectedPiece = null;
        this.isGameOver = false;
        this.winner = null;
        this.history = [];
        this.moveLog = [];

        if (!customBoard) this.setupInitialBoard();
    }

    setupInitialBoard() {
        // Red Pieces (Bottom, Rows 0-4)
        this.board[0][0] = { type: 'rook', color: 'red', name: '車' };
        this.board[0][1] = { type: 'knight', color: 'red', name: '馬' };
        this.board[0][2] = { type: 'elephant', color: 'red', name: '相' };
        this.board[0][3] = { type: 'advisor', color: 'red', name: '仕' };
        this.board[0][4] = { type: 'king', color: 'red', name: '帥' };
        this.board[0][5] = { type: 'advisor', color: 'red', name: '仕' };
        this.board[0][6] = { type: 'elephant', color: 'red', name: '相' };
        this.board[0][7] = { type: 'knight', color: 'red', name: '馬' };
        this.board[0][8] = { type: 'rook', color: 'red', name: '車' };
        
        this.board[2][1] = { type: 'cannon', color: 'red', name: '炮' };
        this.board[2][7] = { type: 'cannon', color: 'red', name: '炮' };
        
        this.board[3][0] = { type: 'pawn', color: 'red', name: '兵' };
        this.board[3][2] = { type: 'pawn', color: 'red', name: '兵' };
        this.board[3][4] = { type: 'pawn', color: 'red', name: '兵' };
        this.board[3][6] = { type: 'pawn', color: 'red', name: '兵' };
        this.board[3][8] = { type: 'pawn', color: 'red', name: '兵' };

        // Black Pieces (Top, Rows 5-9)
        this.board[9][0] = { type: 'rook', color: 'black', name: '車' };
        this.board[9][1] = { type: 'knight', color: 'black', name: '馬' };
        this.board[9][2] = { type: 'elephant', color: 'black', name: '象' };
        this.board[9][3] = { type: 'advisor', color: 'black', name: '士' };
        this.board[9][4] = { type: 'king', color: 'black', name: '將' };
        this.board[9][5] = { type: 'advisor', color: 'black', name: '士' };
        this.board[9][6] = { type: 'elephant', color: 'black', name: '象' };
        this.board[9][7] = { type: 'knight', color: 'black', name: '馬' };
        this.board[9][8] = { type: 'rook', color: 'black', name: '車' };
        
        this.board[7][1] = { type: 'cannon', color: 'black', name: '炮' };
        this.board[7][7] = { type: 'cannon', color: 'black', name: '炮' };
        
        this.board[6][0] = { type: 'pawn', color: 'black', name: '卒' };
        this.board[6][2] = { type: 'pawn', color: 'black', name: '卒' };
        this.board[6][4] = { type: 'pawn', color: 'black', name: '卒' };
        this.board[6][6] = { type: 'pawn', color: 'black', name: '卒' };
        this.board[6][8] = { type: 'pawn', color: 'black', name: '卒' };
    }

    getBoardState() {
        return this.board;
    }

    // 處理滑鼠點擊方格的邏輯，回傳動作供 UI/Renderer 處理
    handleInteraction(row, col) {
        if (this.isGameOver) return null;

        const clickedPiece = this.board[row][col];

        if (this.selectedPiece) {
            const { row: sr, col: sc } = this.selectedPiece;
            
            // 點擊自己的其他棋子 -> 重新選擇
            if (clickedPiece && clickedPiece.color === this.currentPlayer) {
                this.selectedPiece = { row, col };
                return { type: 'select', row, col };
            }
            
            // 點擊空地或敵方棋子 -> 嘗試移動
            if (this.isAllowedMove(sr, sc, row, col)) {
                return { type: 'move', fromRow: sr, fromCol: sc, toRow: row, toCol: col };
            } else if (this.isValidMove(sr, sc, row, col)) {
                /* 走法本身合法、只是踩到長將 ⇒ 要**講出為什麼**。
                   靜靜取消選擇的話,玩家看到的是「這步剛剛還能走,現在點了沒反應」。 */
                this.selectedPiece = null;
                return { type: 'perpetual' };
            } else {
                // 不合法移動 -> 取消選擇
                this.selectedPiece = null;
                return { type: 'deselect' };
            }
        } else {
            // 還沒選擇棋子，只能點擊自己的棋子
            if (clickedPiece && clickedPiece.color === this.currentPlayer) {
                this.selectedPiece = { row, col };
                return { type: 'select', row, col };
            }
        }
        return null;
    }

    /* ═══ 長將規則(對局場招牌之一,線上原版的訊息:
           「同樣追殺將帥的走法最多連續 3 回,請改變走法。」)═══

       判準寫死成「同一方、同一步、連續、而且每一次都在將軍」:
       ⚠ 只看「連續將軍幾次」是**錯的** —— 一路把對方將死的正解常常就是連續將軍好幾步,
         那種每一步都不一樣,不是在耗人。真正要擋的是**同一步來回**。
       ⚠ 也不能只看「同一步重複」 —— 不將軍的重複走法是和棋議題,不是這條規則要管的。
       ★ 江湖殘局的正解常含連續將軍(施工單 §4.4),所以題庫驗證要**開著這條規則**驗,
         不然會收進「題目合法、照正解走到第 4 回被判違規」的死題。 */
    static PERPETUAL_LIMIT = 3;

    moveKey(fromRow, fromCol, toRow, toCol) {
        return `${fromRow},${fromCol}>${toRow},${toCol}`;
    }

    // 局面指紋:盤面 + 輪到誰。長將規則要靠它判斷「有沒有繞回同一個局面」。
    positionKey() {
        let s = this.currentPlayer + '|';
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                s += p ? p.color[0] + p.type + ',' : '.';
            }
        }
        return s;
    }

    /* 這一步走下去會不會踩到長將?(true = 不准走)

       ★★ 判準是**連續將軍 + 局面重複**,兩個條件都要成立才擋。
       ⚠ 只看「連續將軍幾次」是**錯的,而且會毀掉殘局**:江湖殘局的正解常常就是
         一路將到底(施工單 §4.4 專門警告過)。那種每一步都在把對方逼近死路,
         局面**不會重複**;真正該擋的是「一直將、卻在原地繞圈」。
       ⚠ 只看「局面重複」也不對 —— 不將軍的重複是和棋議題,不歸這條規則管。
       ⇒ 兩個條件疊起來,正解不受影響、耗人的長將擋得住。

       第一版我寫成「同一步緊接著重複」,結果**永遠擋不到**:真實對局裡要重複同一步,
       中間一定得先把子走回去,那一步就把「連續」打斷了。測試當場抓出來(blocked=null)。 */
    wouldBePerpetualCheck(fromRow, fromCol, toRow, toCol) {
        const side = this.currentPlayer;
        const enemy = side === 'red' ? 'black' : 'red';

        // 先試走:不是將軍就與這條規則無關;是將軍就順手取得走完之後的局面指紋
        const moved = this.board[fromRow][fromCol];
        const eaten = this.board[toRow][toCol];
        this.board[toRow][toCol] = moved;
        this.board[fromRow][fromCol] = null;
        const givesCheck = this.isInCheck(enemy);
        this.currentPlayer = enemy;                       // 指紋含「輪到誰」
        const nextKey = this.positionKey();
        this.currentPlayer = side;
        this.board[fromRow][fromCol] = moved;
        this.board[toRow][toCol] = eaten;
        if (!givesCheck) return false;

        // 條件一:這一方最近連續幾個回合都在將軍(碰到一次沒將軍就中斷)
        let checkStreak = 0;
        for (let i = this.moveLog.length - 1; i >= 0; i--) {
            const entry = this.moveLog[i];
            if (entry.side !== side) continue;             // 對方的步不打斷
            if (entry.givesCheck) checkStreak++;
            else break;
        }
        if (checkStreak < GameLogic.PERPETUAL_LIMIT) return false;

        // 條件二:走完會回到一個**出現過**的局面 ⇒ 在原地繞圈
        return this.moveLog.some((entry) => entry.positionKey === nextKey);
    }

    // 實際執行移動並切換回合
    executeMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        const targetPiece = this.board[toRow][toCol];

        /* 悔棋:動手**之前**先存整局快照。
           ⚠ 存的是深拷貝 —— 存參考的話,下一步就把「過去」一起改掉了,
             而且悔棋回來看起來一切正常(棋盤是對的、只是那是現在這一盤)。 */
        this.history.push({
            board: this.board.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
            currentPlayer: this.currentPlayer,
            isGameOver: this.isGameOver,
            winner: this.winner,
            moveLogLength: this.moveLog.length,
        });
        if (this.history.length > 200) this.history.shift();

        // 檢查是否吃掉將/帥 (簡單的勝負判定)
        if (targetPiece && targetPiece.type === 'king') {
            this.isGameOver = true;
            this.winner = this.currentPlayer;
        }

        // 移動棋子
        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        // 長將規則要的紀錄:誰、走了哪一步、有沒有將到對方、走完之後的局面指紋
        const enemy = this.currentPlayer === 'red' ? 'black' : 'red';
        const givesCheck = this.isInCheck(enemy);
        const mover = this.currentPlayer;

        // 切換回合
        this.currentPlayer = enemy;
        this.selectedPiece = null;

        this.moveLog.push({
            key: this.moveKey(fromRow, fromCol, toRow, toCol),
            side: mover,
            givesCheck,
            positionKey: this.positionKey(),   // ⚠ 要在換手**之後**取,和 wouldBePerpetualCheck 同一個算法
        });
        
        // 檢查是否將軍或困斃 (進階勝負判定可在這裡補充)
        // 檢查飛將 (兩個王是否照面中間無阻擋) - 這裡需在每次移動後檢查，如果是自己導致照面則為犯規(被禁止的移動)，如果是吃掉對方王則遊戲結束
        // 為了簡單，先不阻擋犯規移動，但在 isValidMove 中會盡量過濾
    }

    /* 悔棋:退回 N 個半回合。
       對局場的「後悔一步」= 退 2 個半回合(你的 + AI 回的),讓你重下自己那一手;
       AI 先手而你還沒走過時只退 1。呼叫端決定退幾步,這裡只管退得乾淨。
       回傳實際退了幾步(0 = 沒得退,呼叫端據此給誠實的訊息)。 */
    undo(steps = 1) {
        let done = 0;
        for (let i = 0; i < steps; i++) {
            const snap = this.history.pop();
            if (!snap) break;
            this.board = snap.board;
            this.currentPlayer = snap.currentPlayer;
            this.isGameOver = snap.isGameOver;
            this.winner = snap.winner;
            this.moveLog.length = snap.moveLogLength;   // 長將的連續計數也要一起退
            this.selectedPiece = null;
            done++;
        }
        return done;
    }

    canUndo() {
        return this.history.length > 0;
    }

    /* isValidMove = **純走法幾何**(這顆棋能不能這樣走)。
       isAllowedMove = 幾何 + 對局規則(目前只有長將)。
       ⚠ 兩個分開是刻意的:isInCheck / 提示驗證 / AI 搜尋要的是幾何,
         把長將摻進去會讓「這一步將不將得到軍」的判斷自己咬自己。 */
    isAllowedMove(fromRow, fromCol, toRow, toCol) {
        if (!this.isValidMove(fromRow, fromCol, toRow, toCol)) return false;
        return !this.wouldBePerpetualCheck(fromRow, fromCol, toRow, toCol);
    }

    getLegalMovesForPiece(row, col) {
        const moves = [];
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.isAllowedMove(row, col, r, c)) {
                    moves.push({ row: r, col: c });
                }
            }
        }
        return moves;
    }

    // 將所有棋子的移動規則委託給 PiecesRules 處理
    isValidMove(fromRow, fromCol, toRow, toCol) {
        // 不能原地不動
        if (fromRow === toRow && fromCol === toCol) return false;
        
        const piece = this.board[fromRow][fromCol];
        if (!piece) return false;
        
        const targetPiece = this.board[toRow][toCol];
        // 不能吃自己的棋子
        if (targetPiece && targetPiece.color === piece.color) return false;

        if (!PiecesRules.checkRules(this.board, fromRow, fromCol, toRow, toCol)) return false;

        /* ★ 2026-09-04 補:不得自將。
           走法規則(PiecesRules)只管「這顆棋子能不能這樣走」,不管「走完自己會不會被將」。
           少了這一條,玩家可以把擋在中路的仕走開、讓對方的車直接照到自己的帥(飛將照面同理),
           下一手就被吃掉——遊戲不會阻止,看起來像「我明明還能走,怎麼就輸了」。
           isInCheck() 本來就寫好了,只是從來沒有人呼叫它(原註解:「為 Milestone 4 及 AI 預留」)。
           ⚠ 直接動 this.board 再還原,不複製盤面:getLegalMovesForPiece 一次要問 90 格,
              複製 90 次 10×9 陣列在手機上會頓。 */
        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;
        const selfCheck = this.isInCheck(piece.color);
        this.board[fromRow][fromCol] = piece;
        this.board[toRow][toCol] = targetPiece;
        return !selfCheck;
    }
    
    // 檢查指定玩家是否被將軍 (為 Milestone 4 及 AI 預留)
    isInCheck(color) {
        // 尋找王的座標
        let kingPos = null;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (p && p.type === 'king' && p.color === color) {
                    kingPos = {r, c};
                    break;
                }
            }
            if (kingPos) break;
        }
        if (!kingPos) return false; // 王被吃了
        
        // 檢查敵方所有棋子是否能攻擊到王
        const enemyColor = color === 'red' ? 'black' : 'red';
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (p && p.color === enemyColor) {
                    if (PiecesRules.checkRules(this.board, r, c, kingPos.r, kingPos.c)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}