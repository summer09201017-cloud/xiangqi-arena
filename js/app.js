// js/app.js - 3D 象棋對局場:UI 狀態管理與接線
//
// ★ 這一版是**重建**:線上舊站(incandescent-stroopwafel-31007a)沒有源碼,
//   引擎與題庫移植自 summer09201017-cloud/3D-Xiangqi,對局場專屬的四件
//   (開局譜 / 存讀檔 / 2D-3D 視角 / 長將規則)是照舊站的行為重寫的。
//   規格書:hfpc-claude-skills/references/象棋對局場-每日殘局移植規格-2026-09-01.md

const DIFFICULTY_LABEL = { easy: 'Lv.1 初級', medium: 'Lv.2 中級', hard: 'Lv.3 高級' };
const SIDE_LABEL = { red: '紅方', black: '黑方' };

/* backup-chain:ok —— 下面兩個鍵刻意不接匯出/匯入(這站沒有、也不打算有備份功能):
   · xiangqi-daily-v1    = 這台裝置上每日殘局的最佳步數,掉了就是重解一次,不是教出來的資料
   · xiangqi-arena-prefs-v1 = 難度/棋譜/執方/視角,純裝置層偏好
   守門 #42 擋的是「使用者一筆一筆教出來的東西靜靜歸零」,這兩個都不是。 */
const DAILY_BOOK_KEY = 'xiangqi-daily-v1';
const PREFS_KEY = 'xiangqi-arena-prefs-v1';

/* 內建瀏覽器偵測(#30)。★ 教會的連結**都走 LINE 發** ——
   從 LINE 訊息點進來就是 LINE 自己的 WebView,beforeinstallprompt 永遠不會觸發,
   而使用者在手機設定裡怎麼調都沒用。所以:
    ① 只提醒不擋(LINE 偶爾也拿得到);
    ② 命中時**只講換瀏覽器那一條**(並列三條會讓他先去試沒用的);
    ③ 開場就講,不要等他按了沒反應才講。
   ⚠ 不可以用 /line/i —— "offline"、"inline"、"Baseline" 都會誤中。 */
const IN_APP_BROWSER = (() => {
    const ua = navigator.userAgent || '';
    if (/\bLine\//i.test(ua) || /\bLIFF\b/i.test(ua)) return { name: 'LINE', how: '右上角「⋯」→「用其他瀏覽器開啟」' };
    if (/FBAN|FBAV|FB_IAB|FB4A/i.test(ua)) return { name: 'Facebook', how: '右上角「⋯」→「在外部瀏覽器中開啟」' };
    if (/Instagram/i.test(ua)) return { name: 'Instagram', how: '右上角「⋯」→「在瀏覽器中開啟」' };
    if (/MicroMessenger/i.test(ua)) return { name: '微信', how: '右上角「⋯」→「在瀏覽器中開啟」' };
    return null;
})();

class ArenaApp {
    constructor() {
        this.renderer = new ChessRenderer();
        this.gameLogic = new GameLogic();
        this.ai = new ChessAI();

        this.difficulty = 'medium';
        this.openingBook = 'all';
        this.humanSide = 'red';
        this.viewMode = '3d';

        this.daily = null;          // null = 一般對局;{ key, index, set, puzzle } = 今天第 N 題
        this.dailySaved = false;    // 這一題的成績記過了沒(一局只記一次)
        this.humanMoves = 0;        // 每日殘局計步(只數玩家自己)
        this.aiThinking = false;
        this.hint = null;           // 💡 { positionKey, from, to }
        this.deferredPrompt = null;
        this.pseudoFs = false;      // ⛶ 沒有原生全螢幕(iPhone Safari)時的 CSS 假全螢幕

        this.cacheElements();
        this.fillSelects();
        this.loadPrefs();
        this.bindEvents();
        this.startGame();
    }

    cacheElements() {
        const $ = (id) => document.getElementById(id);
        this.el = {
            statusText: $('statusText'), turnChip: $('turnChip'), tipText: $('tipText'),
            dailyLine: $('dailyLine'), summaryText: $('summaryText'), openingHint: $('openingHint'),
            sideSelect: $('sideSelect'), viewSelect: $('viewSelect'),
            difficultySelect: $('difficultySelect'), openingSelect: $('openingSelect'),
            newGameButton: $('newGameButton'), hintButton: $('hintButton'), undoButton: $('undoButton'),
            cameraButton: $('cameraButton'), saveButton: $('saveButton'), loadButton: $('loadButton'),
            rotateLeftButton: $('rotateLeftButton'), rotateRightButton: $('rotateRightButton'),
            installButton: $('installButton'), installHint: $('installHint'),
            dailyButton: $('dailyButton'),
            overlay: $('gameOverOverlay'), winnerText: $('winnerText'),
            dailyNextButton: $('dailyNextButton'), dailyRetryButton: $('dailyRetryButton'),
            retryButton: $('retryButton'),
            // ⛶ 全螢幕棋盤
            fsButton: $('fsButton'), fsButton2: $('fsButton2'), fsToolbar: $('fsToolbar'),
            fsHintButton: $('fsHintButton'), fsUndoButton: $('fsUndoButton'),
            fsCameraButton: $('fsCameraButton'), fsExitButton: $('fsExitButton'),
            fsNewGameButton: $('fsNewGameButton'), fsDailyButton: $('fsDailyButton'), fsDifficultySelect: $('fsDifficultySelect'),
            stagePanel: document.querySelector('.stage-panel'),
        };
    }

    // 開局譜下拉是從 OPENING_BOOKS 生出來的,不手抄第二份(手抄的一定會漂移)
    fillSelects() {
        const order = ['all', 'cannon', 'elephant', 'knight', 'pawn', 'none'];
        this.el.openingSelect.innerHTML = '';
        for (const key of order) {
            const book = OPENING_BOOKS[key];
            if (!book) continue;
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = book.label + (book.lines.length ? `(${book.lines.length} 條)` : '');
            this.el.openingSelect.append(opt);
        }
    }

    /* 偏好(難度/譜/執方/視角)存本機。
       ⚠ 這是**裝置層偏好**不是對局資料,和存檔分開兩個鍵 —— 混在一起的話
         「讀檔」會把玩家現在的難度設定一起蓋掉。 */
    loadPrefs() {
        let prefs = {};
        try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { prefs = {}; }
        if (DIFFICULTY_LABEL[prefs.difficulty]) this.difficulty = prefs.difficulty;
        if (OPENING_BOOKS[prefs.openingBook]) this.openingBook = prefs.openingBook;
        if (prefs.humanSide === 'black' || prefs.humanSide === 'red') this.humanSide = prefs.humanSide;
        if (prefs.viewMode === '2d' || prefs.viewMode === '3d') this.viewMode = prefs.viewMode;

        this.el.difficultySelect.value = this.difficulty;
        this.el.openingSelect.value = this.openingBook;
        this.el.sideSelect.value = this.humanSide;
        this.el.viewSelect.value = this.viewMode;
    }

    savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                difficulty: this.difficulty, openingBook: this.openingBook,
                humanSide: this.humanSide, viewMode: this.viewMode,
            }));
        } catch (_) { /* 私密模式:記不住偏好不影響下棋 */ }
    }

    bindEvents() {
        const el = this.el;
        el.newGameButton.addEventListener('click', () => this.startGame());
        el.hintButton.addEventListener('click', () => this.showHint());
        el.undoButton.addEventListener('click', () => this.undo());
        el.cameraButton.addEventListener('click', () => {
            this.renderer.resetView();
            this.say('視角已重置。');
        });

        /* ⛶ 全螢幕棋盤(0902 使用者:「下棋的畫面太小」)。
           工具列那三顆一律**轉呼叫側欄原本的鈕**(click()),不另寫一份邏輯 ——
           原鈕 disabled 時 click() 本來就不會動,亮暗狀態也在 render() 一起同步。 */
        el.fsButton.addEventListener('click', () => this.toggleFullscreen());
        el.fsButton2.addEventListener('click', () => this.toggleFullscreen());
        el.fsExitButton.addEventListener('click', () => this.exitFullscreen());
        el.fsHintButton.addEventListener('click', () => el.hintButton.click());
        el.fsUndoButton.addEventListener('click', () => el.undoButton.click());
        el.fsCameraButton.addEventListener('click', () => el.cameraButton.click());
        // 0905 v8:全螢幕裡也能重新開局 / 進每日殘局 / 換難度(使用者反映每次都得先離開全螢幕才能換設定)。
        //   一律「代按右側欄的原鈕」,不另寫一套流程 —— 邏輯只有一份,全螢幕只是另一個入口。
        el.fsNewGameButton.addEventListener('click', () => el.newGameButton.click());
        el.fsDailyButton.addEventListener('click', () => el.dailyButton.click());
        el.fsDifficultySelect.innerHTML = el.difficultySelect.innerHTML;
        el.fsDifficultySelect.value = el.difficultySelect.value;
        el.fsDifficultySelect.addEventListener('change', () => {
            el.difficultySelect.value = el.fsDifficultySelect.value;
            el.difficultySelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        el.difficultySelect.addEventListener('change', () => { el.fsDifficultySelect.value = el.difficultySelect.value; });
        document.addEventListener('fullscreenchange', () => this.applyFullscreenClass());
        document.addEventListener('webkitfullscreenchange', () => this.applyFullscreenClass());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.pseudoFs) this.exitFullscreen();
        });
        el.saveButton.addEventListener('click', () => this.saveGame());
        el.loadButton.addEventListener('click', () => this.loadGame());
        el.rotateLeftButton.addEventListener('click', () => this.spin(-45));
        el.rotateRightButton.addEventListener('click', () => this.spin(45));
        el.dailyButton.addEventListener('click', () => this.startDaily());
        el.retryButton.addEventListener('click', () => this.startGame());
        el.dailyRetryButton.addEventListener('click', () => this.startDaily(this.daily ? this.daily.index : 0));
        el.dailyNextButton.addEventListener('click', () => {
            const next = this.nextUnsolvedIndex();
            this.startDaily(next >= 0 ? next : 0);
        });

        el.difficultySelect.addEventListener('change', () => {
            this.difficulty = el.difficultySelect.value;
            this.savePrefs(); this.render();
        });
        el.openingSelect.addEventListener('change', () => {
            this.openingBook = el.openingSelect.value;
            this.savePrefs(); this.render();
        });
        el.sideSelect.addEventListener('change', () => {
            this.humanSide = el.sideSelect.value;
            this.savePrefs(); this.startGame();
        });
        el.viewSelect.addEventListener('change', () => {
            this.viewMode = el.viewSelect.value;
            this.renderer.setViewMode(this.viewMode);
            this.savePrefs(); this.render();
        });

        /* 在 LINE/FB 的內建瀏覽器裡:安裝鈕**永遠不會出現**(事件不觸發)⇒
           開場就直說要換瀏覽器,不要留一個等不到的承諾。 */
        if (IN_APP_BROWSER) {
            el.installHint.textContent =
                `你正從 ${IN_APP_BROWSER.name} 的內建瀏覽器開啟,無法安裝到主畫面。`
                + `請用 ${IN_APP_BROWSER.how},再回來安裝。`;
        }

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.deferredPrompt = event;
            el.installButton.classList.remove('hidden');
            el.installHint.textContent = '已支援安裝,按下「安裝到手機」即可加入主畫面。';
        });
        el.installButton.addEventListener('click', async () => {
            if (!this.deferredPrompt) return;
            this.deferredPrompt.prompt();
            await this.deferredPrompt.userChoice;
            this.deferredPrompt = null;
            el.installButton.classList.add('hidden');
        });

        this.renderer.onPieceClick = (row, col) => this.handleSquareClick(row, col);
    }

    /* ═══ 開局 ═══ */
    startGame() {
        this.daily = null;
        this.dailySaved = false;
        this.humanMoves = 0;
        this.hint = null;
        this.aiThinking = false;
        this.gameLogic.initGame();
        this.bootScene();
        this.say('點選任一' + (this.humanSide === 'red' ? '紅' : '黑') + '棋開始。');
        this.maybeAiMove();
    }

    /* 📅 每日殘局:每天一組 5 題,全世界同一組、同一順序。 */
    startDaily(index) {
        const key = dailyPuzzleKey();
        const set = puzzlesForDate(key);
        const solved = this.dailySolved(key);
        let idx = Number.isInteger(index) ? index : set.puzzles.findIndex((p) => !solved[p.id]);
        if (idx < 0 || idx >= set.puzzles.length) idx = 0;

        this.daily = { key, index: idx, set, puzzle: set.puzzles[idx] };
        this.dailySaved = false;
        this.humanMoves = 0;
        this.hint = null;
        this.aiThinking = false;
        /* 殘局一律紅方(玩家)先手 —— 題目就是照「紅先勝」設計的。
           ⚠ 這裡覆蓋玩家的執方偏好,但**不寫回 savePrefs**:
             他選的是一般對局要執哪一邊,不該被殘局改掉。 */
        this.gameLogic.initGame(buildPuzzleBoard(this.daily.puzzle));
        this.bootScene();
        this.say(`📅 ${this.daily.puzzle.name}:${this.daily.puzzle.hint}`);
    }

    bootScene() {
        this.renderer.initScene(this.gameLogic.getBoardState());
        this.renderer.setViewMode(this.viewMode);
        this.renderer.animate();
        this.hideOverlay();
        this.render();
    }

    /* ═══ 互動 ═══ */
    handleSquareClick(row, col) {
        if (this.gameLogic.isGameOver || this.aiThinking) return;
        if (this.gameLogic.currentPlayer !== this.playerSide()) return;   // 不是你的回合

        const action = this.gameLogic.handleInteraction(row, col);
        if (!action) return;

        if (action.type === 'select') {
            this.renderer.highlightSquare(row, col);
            this.renderer.highlightMoves(this.gameLogic.getLegalMovesForPiece(row, col));
        } else if (action.type === 'deselect') {
            this.renderer.clearHighlights();
        } else if (action.type === 'perpetual') {
            /* 長將被擋:一定要**講出原因**。靜靜取消的話,玩家看到的是
               「這步剛剛還能走、現在點了沒反應」,他會以為遊戲壞了。 */
            this.renderer.clearHighlights();
            this.say('同樣追殺將帥的走法最多連續 3 回,請改變走法。');
        } else if (action.type === 'move') {
            this.renderer.clearHighlights();
            this.applyMove(action.fromRow, action.fromCol, action.toRow, action.toCol, true);
        }
    }

    applyMove(fromRow, fromCol, toRow, toCol, byHuman) {
        this.gameLogic.executeMove(fromRow, fromCol, toRow, toCol);
        if (byHuman && this.daily) this.humanMoves += 1;
        this.hint = null;                       // 局面變了,舊建議作廢
        this.renderer.movePiece(fromRow, fromCol, toRow, toCol, () => {
            this.renderer.updateBoardState(this.gameLogic.getBoardState());
            this.render();
            if (this.checkGameState()) return;
            this.maybeAiMove();
        });
    }

    playerSide() { return this.daily ? 'red' : this.humanSide; }
    aiSide() { return this.playerSide() === 'red' ? 'black' : 'red'; }

    /* ═══ AI ═══ */
    maybeAiMove() {
        if (this.gameLogic.isGameOver) return;
        if (this.gameLogic.currentPlayer !== this.aiSide()) return;

        this.aiThinking = true;
        this.render();
        // 讓瀏覽器先把「AI 思考中」畫出來,再進同步搜尋
        setTimeout(() => {
            let move = null;

            /* ① 先看開局譜。
               ⚠⚠ 每日殘局一律不吃譜(施工單 §4.2)—— 走 effectiveBook 強制掉,
                 **不可以**指望「殘局盤面自然對不上譜」:實測 16 題裡有 7 題對得上。 */
            const book = effectiveBook(this.openingBook, Boolean(this.daily));
            if (this.aiSide() === 'black') {
                move = pickOpeningMove(book, this.gameLogic.moveLog, this.gameLogic);
            }

            // ② 譜沒話說就搜尋。殘局的 AI 一律用最高強度(守得認真才有題味)
            if (!move) {
                const level = this.daily ? 'hard' : this.difficulty;
                try {
                    move = this.ai.calculateBestMove(this.gameLogic.getBoardState(), this.aiSide(), level);
                } catch (error) {
                    console.error('[ai] calculateBestMove threw:', error);
                }
            }

            // ③ 搜出來的走法要過真正的規則(ai.js 的走法產生器不含長將)
            if (move && !this.gameLogic.isAllowedMove(move.from.row, move.from.col, move.to.row, move.to.col)) {
                move = this.fallbackMove(this.aiSide());
            }

            this.aiThinking = false;
            if (!move) {                       // 真的無步可走 = 困斃,對方勝
                this.gameLogic.isGameOver = true;
                this.gameLogic.winner = this.playerSide();
                this.render();
                this.checkGameState();
                return;
            }
            this.applyMove(move.from.row, move.from.col, move.to.row, move.to.col, false);
        }, 60);
    }

    // 掃一步合法的當保底(搜尋壞掉時不要讓遊戲卡死)
    fallbackMove(color) {
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.gameLogic.getBoardState()[r][c];
                if (!p || p.color !== color) continue;
                for (const m of this.gameLogic.getLegalMovesForPiece(r, c)) {
                    return { from: { row: r, col: c }, to: { row: m.row, col: m.col } };
                }
            }
        }
        return null;
    }

    /* ═══ 💡 AI 提示(全艦隊棋類批次:借同一支引擎,從玩家這一邊算一手)═══
       ① 給出去之前先過 isAllowedMove —— ai.js 的走法產生器不含長將(
          自己註解也寫著不考慮將軍),不驗的話會提示一手玩家**點不動**的棋。
       ② 同一個局面按幾次都回同一手:calculateBestMove 內部有 moves.sort(random),
          不快取的話同分的兩手會輪流跳,看起來像跳針。
       ③ 文案三態不可混講:有建議 / 沒有合法著法 / 算的時候出事。 */
    showHint() {
        if (this.gameLogic.isGameOver) { this.say('💡 這一局已經結束了。'); return; }
        if (this.aiThinking) return;
        if (this.gameLogic.currentPlayer !== this.playerSide()) return;

        const key = this.gameLogic.positionKey();
        if (this.hint && this.hint.positionKey === key) { this.paintHint(this.hint); return; }

        this.say('💡 想一手…');
        setTimeout(() => {
            let move = null;
            try {
                move = this.ai.calculateBestMove(this.gameLogic.getBoardState(), this.playerSide(), 'hint');
                if (move && !this.gameLogic.isAllowedMove(
                    move.from.row, move.from.col, move.to.row, move.to.col)) move = null;
            } catch (error) {
                console.error('[hint] calculateBestMove threw:', error);
                this.say('💡 這一手算不出來,先自己走走看。');
                return;
            }
            if (!move) { this.say('💡 找不到可走的棋了。'); return; }
            this.hint = { positionKey: key, from: move.from, to: move.to };
            this.paintHint(this.hint);
        }, 30);
    }

    paintHint(hint) {
        const board = this.gameLogic.getBoardState();
        const piece = board[hint.from.row][hint.from.col];
        const eat = board[hint.to.row][hint.to.col];
        this.renderer.highlightSquare(hint.from.row, hint.from.col);   // 內含 clearHighlights
        this.renderer.highlightMoves([{ row: hint.to.row, col: hint.to.col }]);
        this.say(`💡 建議走「${piece ? piece.name : '這顆'}」`
            + (eat ? `,吃掉對方的「${eat.name}」` : '')
            + '(綠圈是它,綠點是要去的地方)');
    }

    /* ═══ 悔棋 ═══ */
    undo() {
        if (this.aiThinking) return;
        /* 退兩個半回合(你的 + AI 回的),讓你重下自己那一手;
           若只剩一步(例如 AI 先手才走了一手)就退一步。 */
        const want = this.gameLogic.history.length >= 2 ? 2 : 1;
        const done = this.gameLogic.undo(want);
        if (!done) { this.say('目前沒有可返回的步數。'); return; }

        if (this.daily) this.humanMoves = Math.max(0, this.humanMoves - 1);
        this.dailySaved = false;   // 悔棋後重新解出來可以再記(取當日最少,不會灌水)
        this.hint = null;
        this.renderer.clearHighlights();
        this.renderer.updateBoardState(this.gameLogic.getBoardState());
        this.hideOverlay();
        this.render();
        this.say(`已返回 ${done} 步,連按可繼續往前回到更早的局面。`);
    }

    /* ═══ 存讀檔 ═══ */
    saveGame() {
        /* ⚠ 施工單 §4.3:每日殘局**不進存檔**。
           存檔是「我這盤下到一半」,而殘局是「今天這一題」——
           存起來明天讀出來會跟當天的題目打架。這裡直說原因,不是靜靜不做。 */
        if (this.daily) { this.say('每日殘局不用存檔——明天自動換新的一組,今天的最佳步數已另外記著!'); return; }
        const result = SaveManager.save(this.gameLogic, {
            difficulty: this.difficulty, openingBook: this.openingBook,
            humanSide: this.humanSide, viewMode: this.viewMode,
        });
        this.say(result.ok ? '已存檔,可稍後用「讀檔」接續對局。'
                           : '存檔失敗,請確認瀏覽器允許本機儲存。');
    }

    loadGame() {
        const result = SaveManager.load();
        if (!result.ok) {
            // 三態要分開講:沒存過 / 存過但讀不到 / 檔壞了
            const msg = { empty: '目前沒有存檔。', read: '讀檔失敗,請確認瀏覽器允許本機儲存。' }[result.reason]
                || '存檔內容看起來壞了,請重新存檔後再試。';
            this.say(msg);
            return;
        }
        const data = result.data;
        this.daily = null;                     // 讀檔一律離開每日模式
        this.dailySaved = false;
        this.humanMoves = 0;
        this.hint = null;
        this.aiThinking = false;

        this.gameLogic.initGame(data.board.map((row) => row.map((c) => (c ? { ...c } : null))));
        this.gameLogic.currentPlayer = data.currentPlayer === 'black' ? 'black' : 'red';
        const s = data.settings || {};
        if (DIFFICULTY_LABEL[s.difficulty]) this.difficulty = s.difficulty;
        if (OPENING_BOOKS[s.openingBook]) this.openingBook = s.openingBook;
        if (s.humanSide === 'red' || s.humanSide === 'black') this.humanSide = s.humanSide;
        if (s.viewMode === '2d' || s.viewMode === '3d') this.viewMode = s.viewMode;
        this.el.difficultySelect.value = this.difficulty;
        this.el.openingSelect.value = this.openingBook;
        this.el.sideSelect.value = this.humanSide;
        this.el.viewSelect.value = this.viewMode;

        this.bootScene();
        this.say('已讀檔,對局已恢復。');
        this.maybeAiMove();
    }

    spin(delta) {
        if (!this.renderer.spinBoard(delta)) {
            this.say('請先切換到 2D 視角,再使用旋轉功能。');
            return;
        }
        this.say(delta < 0 ? '2D 視角已向左旋轉。' : '2D 視角已向右旋轉。');
    }

    /* ═══ 勝負與每日戰績 ═══ */
    checkGameState() {
        if (!this.gameLogic.isGameOver) return false;

        if (this.daily && this.gameLogic.winner === 'red') {
            if (this.dailySaved) return true;
            this.dailySaved = true;
            const r = this.saveDailyResult(this.daily.key, this.daily.puzzle.id, this.humanMoves);
            const total = this.daily.set.puzzles.length;
            const done = this.nextUnsolvedIndex() < 0;
            this.showOverlay(
                `📅 第 ${this.daily.index + 1} 題完成!用了 ${this.humanMoves} 步`
                + (r.isNewBest ? '(新紀錄!)' : `(這題最佳 ${r.best} 步)`)
                + `\n今天已解 ${r.solvedCount}/${total} 題`
                + (done ? '\n—— 今天全解完了,明天有新的一組!' : ''),
                { daily: true, hasNext: !done });
        } else if (this.daily) {
            this.showOverlay('📅 這一題還沒解開,再試一次!', { daily: true, hasNext: false });
        } else {
            const win = this.gameLogic.winner === this.playerSide();
            this.showOverlay(win ? '你贏了!' : `${SIDE_LABEL[this.gameLogic.winner]}獲勝。`, { daily: false });
        }
        this.render();
        return true;
    }

    loadDailyBook() {
        try {
            const s = JSON.parse(localStorage.getItem(DAILY_BOOK_KEY) || '{}');
            return s && typeof s === 'object' ? s : {};
        } catch (_) { return {}; }
    }
    dailySolved(key) {
        const d = this.loadDailyBook()[key];
        return (d && typeof d === 'object' && d.solved) ? d.solved : {};
    }
    saveDailyResult(key, puzzleId, moves) {
        const all = this.loadDailyBook();
        const day = (all[key] && typeof all[key] === 'object' && all[key].solved) ? all[key] : { solved: {} };
        const prev = day.solved[puzzleId] | 0;
        const isNewBest = !prev || moves < prev;
        if (isNewBest) day.solved[puzzleId] = moves;
        all[key] = day;
        const days = Object.keys(all).sort();
        while (days.length > 60) delete all[days.shift()];
        try { localStorage.setItem(DAILY_BOOK_KEY, JSON.stringify(all)); } catch (_) { /* 私密模式 */ }
        return { best: day.solved[puzzleId], isNewBest, solvedCount: Object.keys(day.solved).length };
    }
    nextUnsolvedIndex() {
        if (!this.daily) return -1;
        const solved = this.dailySolved(this.daily.key);
        for (let i = 0; i < this.daily.set.puzzles.length; i++) {
            if (!solved[this.daily.set.puzzles[i].id] && i !== this.daily.index) return i;
        }
        return -1;
    }

    /* ═══ 畫面 ═══ */
    showOverlay(text, opts) {
        this.el.winnerText.textContent = text;
        this.el.overlay.classList.remove('hidden');
        /* ★ 每日模式要有「下一題」,而且要**藏掉「再來一局」**——
           那顆會把孩子丟回一般對局(0831 三款都踩過這個)。 */
        this.el.dailyNextButton.classList.toggle('hidden', !(opts.daily && opts.hasNext));
        this.el.dailyRetryButton.classList.toggle('hidden', !opts.daily);
        this.el.retryButton.classList.toggle('hidden', Boolean(opts.daily));
    }
    hideOverlay() { this.el.overlay.classList.add('hidden'); }

    /* ── ⛶ 全螢幕棋盤 ──
       對象是 .stage-panel(狀態列/提示/結算蓋板都在裡面),不是 canvas:
       只把 canvas 全螢幕的話,「將軍!」「AI 思考中」「結算」全部看不到。
       iPhone Safari 沒有元素全螢幕 ⇒ 退成 CSS 假全螢幕(position:fixed 蓋滿視窗),版面同一套。 */
    nativeFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }
    isFullscreen() { return Boolean(this.nativeFullscreenElement()) || this.pseudoFs; }
    toggleFullscreen() { return this.isFullscreen() ? this.exitFullscreen() : this.enterFullscreen(); }
    async enterFullscreen() {
        const target = this.el.stagePanel;
        const request = target.requestFullscreen || target.webkitRequestFullscreen;
        if (request) {
            try {
                const result = request.call(target, { navigationUI: 'hide' });
                // 舊 WebKit 不回 promise;回 promise 的也不等超過一秒半(卡住就走假全螢幕)
                const isThenable = Boolean(result && typeof result.then === 'function');
                const settle = new Promise((resolve) => setTimeout(resolve, isThenable ? 1500 : 350));
                await (isThenable ? Promise.race([result, settle]) : settle);
            } catch (_) { /* 被拒(iframe 沒授權、非使用者手勢)⇒ 走假全螢幕 */ }
        }
        if (!this.nativeFullscreenElement()) this.pseudoFs = true;
        this.applyFullscreenClass();
    }
    exitFullscreen() {
        this.pseudoFs = false;
        if (this.nativeFullscreenElement()) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            try {
                const result = exit.call(document);
                if (result && typeof result.catch === 'function') result.catch(() => {});
            } catch (_) { /* 已經不在全螢幕了 */ }
        }
        this.applyFullscreenClass();
    }
    applyFullscreenClass() {
        const on = this.isFullscreen();
        const el = this.el;
        el.stagePanel.classList.toggle('is-fs', on);
        el.stagePanel.classList.toggle('pseudo-fs', on && !this.nativeFullscreenElement());
        document.body.classList.toggle('fs-active', on);
        el.fsButton.title = on ? '離開全螢幕' : '全螢幕棋盤';
        el.fsButton.setAttribute('aria-label', el.fsButton.title);
        el.fsButton2.textContent = on ? '⛶ 離開全螢幕' : '⛶ 全螢幕棋盤(畫面放大)';
        /* 版面一變,畫布尺寸就變 ⇒ 相機要重裝。renderer 自己有 ResizeObserver 看著容器,
           這裡再補一次是保險(等瀏覽器排完版的下一幀)。 */
        requestAnimationFrame(() => requestAnimationFrame(() => this.renderer.onWindowResize()));
    }

    say(text) { this.el.statusText.textContent = text; }

    render() {
        const el = this.el;
        const turn = this.gameLogic.currentPlayer;
        el.turnChip.textContent = this.aiThinking ? 'AI 思考中' : `${SIDE_LABEL[turn]}行棋`;
        el.tipText.textContent = this.gameLogic.currentPlayer === this.playerSide()
            ? '先點你的棋子,再點要移動到的位置。'
            : '等待 AI 落子。';

        // 📅 常駐狀態行
        const inDaily = Boolean(this.daily);
        el.dailyLine.classList.toggle('hidden', !inDaily);
        if (inDaily) {
            const solved = this.dailySolved(this.daily.key);
            const done = this.daily.set.puzzles.filter((p) => solved[p.id]).length;
            el.dailyLine.textContent =
                `📅 ${this.daily.key} 第 ${this.daily.index + 1}/${this.daily.set.puzzles.length} 題`
                + `(今天已解 ${done} 題)「${this.daily.puzzle.name}」・已走 ${this.humanMoves} 步`;
        }

        /* ⚠ 每日模式把開局譜選單鎖住並講明原因(施工單 §4.2)——
           只在程式裡旁路、畫面上還讓他選,他會以為自己選的譜有作用。 */
        el.openingSelect.disabled = inDaily;
        el.openingHint.textContent = inDaily
            ? '殘局不吃開局譜(殘局的起手不是標準開局,照譜走題目會壞掉)。'
            : (OPENING_BOOKS[this.openingBook] ? OPENING_BOOKS[this.openingBook].hint : '');

        el.saveButton.disabled = inDaily;
        el.undoButton.disabled = !this.gameLogic.canUndo() || this.aiThinking;
        el.hintButton.disabled = this.aiThinking
            || this.gameLogic.isGameOver
            || this.gameLogic.currentPlayer !== this.playerSide();
        // ⛶ 全螢幕工具列跟側欄同步(它們只是轉呼叫側欄的鈕)
        el.fsUndoButton.disabled = el.undoButton.disabled;
        el.fsHintButton.disabled = el.hintButton.disabled;
        el.fsDailyButton.disabled = el.dailyButton.disabled;
        el.fsDailyButton.classList.toggle('hidden', el.dailyButton.classList.contains('hidden'));

        const rotatable = this.viewMode === '2d';
        el.rotateLeftButton.disabled = !rotatable;
        el.rotateRightButton.disabled = !rotatable;

        const book = OPENING_BOOKS[effectiveBook(this.openingBook, inDaily)];
        el.summaryText.textContent =
            `你執 ${SIDE_LABEL[this.playerSide()]},AI 為 ${SIDE_LABEL[this.aiSide()]},`
            + `難度是 ${DIFFICULTY_LABEL[inDaily ? 'hard' : this.difficulty]},`
            + `棋譜包是 ${book ? book.label : '—'}(${book ? book.lines.length : 0} 條),`
            + `目前是 ${this.viewMode === '2d' ? '2D' : '3D'} 視角。`
            + 'AI 會在開局前 15 手優先參考所選棋譜。';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new ArenaApp();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch((error) => console.warn('[sw]', error));
    }

    /* 📡 統計打點(這站以前完全沒接 = 統計盲區)。
       零個資:只送站名與事件,沒有 cookie、沒有帳號。離線時 sendBeacon 靜默失敗,不影響下棋。
       雙平台化:pages.dev 與 workers.dev 都認得(搬站時不會斷流)。
       ⚠ 0903 修:端點是 /api/ping(不是 /p)、停留秒數的參數叫 t(不是 s)——寫錯的話 Worker 回 404 或丟棄,
       打點全部靜默消失而前端零紅燈(本站 0902~0903 一天多的資料就是這樣沒的)。 */
    try {
        const ping = (evt) => {
            try { navigator.sendBeacon(`https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=${evt}`); }
            catch (_) { /* statistics are best-effort */ }
        };
        ping('xiangqi-arena');
        const openedAt = Date.now();
        let sent = false;
        const dwell = () => {
            if (sent) return;
            sent = true;
            ping(`xiangqi-arena-dwell&t=${Math.round((Date.now() - openedAt) / 1000)}`);
        };
        document.addEventListener('visibilitychange', () => { if (document.hidden) dwell(); });
        window.addEventListener('pagehide', dwell);
        window.__arenaPingDone = () => ping('xiangqi-arena-done');
    } catch (_) { /* 統計壞掉不可以影響遊戲 */ }
});
