// js/ai.js - 中國象棋 AI
//
// ★ 2026-09-04 重寫。舊版三個病(使用者原話「AI 太笨了,常給一些沒用的提示」):
//   ① 走法產生器繞過 gameLogic,直接用 PiecesRules.checkRules ⇒ 會產生「走完自己被將軍」
//      的自殺步,也完全不知道對手在將它 ⇒ 送死、不應將、不會將死。
//   ② 評估只有子力 + 過河兵 +50,沒有位置概念 ⇒ 提示常叫你走一步毫無意義的棋。
//   ③ 沒有靜態搜尋(quiescence)⇒ 水平線效應:第 N 層吃一顆子看起來賺,第 N+1 層被吃回它看不到。
//      easy 深度 1 更是連對手的回手都沒看。
//
// 現在:合法走法(過濾自將/飛將)→ 將軍・將死・困斃 → PST 位置評估 → MVV-LVA 排序
//       → alpha-beta + 靜態搜尋 → 迭代加深(有時間預算,想不完就用上一層的結果)。
//
// ⚠ 所有「這步合不合規矩」一律問 PiecesRules,不自己抄一份 —— 抄一份就會和 UI 分岔,
//    症狀是「提示叫我走這步,但棋子點不動」(test/daily.mjs 有一節專門守這件事)。
//
// 棋盤:board[row][col],row 0-4=紅(下)、row 5-9=黑(上);紅兵往 row 增加走。

class ChessAI {
    constructor() {
        // 子力價值。帥/將不計分 —— 合法走法已經保證王吃不掉,將死由搜尋給 ±MATE。
        this.PIECE_VALUES = {
            king: 0, rook: 900, cannon: 440, knight: 420,
            advisor: 200, elephant: 200, pawn: 100,
        };
        this.MATE = 50000;

        /* 難度檔。時間是上限不是目標——迭代加深想得完就繼續,時間到就交出上一層算完的最好一手。
           ★ 初級刻意留給孩子:深度淺 + 有機率隨手走,不然主日學的孩子一盤都贏不了。
           ★★ 隨機**只給初級**。2026-09-04 消融實測:中級原本設 4% 亂走 + 30 分容差,
              一盤約亂走 3 次,每次可能白丟一台車 ⇒ 對打 3/4 勝、子力 −4540;
              關掉隨機之後 4/4 全勝、子力 +4180。「讓它有變化」不可以用亂走來做。
           ⇒ 中級以上改成 tieRandom:只在**分數完全相同**的走法之間挑,有變化、零棋力代價。
              提示(hint)連同分隨機都不要,才能做到「同一個局面按幾次都回同一手」。 */
        this.LEVELS = {
            easy:   { depth: 2, ms: 150,  blunder: 0.25, slack: 90, tieRandom: true  },
            medium: { depth: 4, ms: 450,  blunder: 0,    slack: 0,  tieRandom: true  },
            hard:   { depth: 6, ms: 1100, blunder: 0,    slack: 0,  tieRandom: true  },
            hint:   { depth: 7, ms: 1400, blunder: 0,    slack: 0,  tieRandom: false },
        };

        // 位置價值表(紅方視角,row 0=紅底線)。黑方用 pst[9-row][col] 鏡射。
        this.PST = {
            pawn: [
                [  0,  0,  0,  0,  0,  0,  0,  0,  0],
                [  0,  0,  0,  0,  0,  0,  0,  0,  0],
                [  0,  0,  0,  0,  0,  0,  0,  0,  0],
                [  6,  0, 10,  0, 14,  0, 10,  0,  6],
                [ 10,  0, 16,  0, 20,  0, 16,  0, 10],
                [ 30, 34, 40, 46, 50, 46, 40, 34, 30],
                [ 40, 46, 56, 66, 70, 66, 56, 46, 40],
                [ 50, 60, 72, 84, 90, 84, 72, 60, 50],
                [ 46, 54, 66, 78, 84, 78, 66, 54, 46],
                [ 30, 36, 44, 52, 56, 52, 44, 36, 30],
            ],
            knight: [
                [ -6,  0,  0,  2,  0,  2,  0,  0, -6],
                [  0,  2,  6,  8,  4,  8,  6,  2,  0],
                [  4,  8, 14, 14, 16, 14, 14,  8,  4],
                [  6, 12, 16, 20, 20, 20, 16, 12,  6],
                [  8, 14, 20, 24, 26, 24, 20, 14,  8],
                [  8, 16, 22, 26, 28, 26, 22, 16,  8],
                [ 10, 18, 24, 28, 30, 28, 24, 18, 10],
                [  8, 14, 20, 24, 26, 24, 20, 14,  8],
                [  4,  8, 12, 16, 18, 16, 12,  8,  4],
                [  0,  2,  4,  8, 10,  8,  4,  2,  0],
            ],
            cannon: [
                [  6,  4,  0, -6, -8, -6,  0,  4,  6],
                [  6,  2,  0, -4, -6, -4,  0,  2,  6],
                [  6,  2,  0, -8,-10, -8,  0,  2,  6],
                [  6,  4,  2,  2,  2,  2,  2,  4,  6],
                [  6,  4,  4,  4,  4,  4,  4,  4,  6],
                [  0,  0,  2,  6,  6,  6,  2,  0,  0],
                [  4,  0,  8,  6, 10,  6,  8,  0,  4],
                [  0,  2,  4,  6,  6,  6,  4,  2,  0],
                [  0,  0,  0,  2,  4,  2,  0,  0,  0],
                [  0,  0,  0,  2,  4,  2,  0,  0,  0],
            ],
            rook: [
                [ -2, 10,  6, 14, 12, 14,  6, 10, -2],
                [  8,  4,  8, 16,  8, 16,  8,  4,  8],
                [  4,  8,  6, 14, 12, 14,  6,  8,  4],
                [  6, 10,  8, 14, 14, 14,  8, 10,  6],
                [ 12, 16, 14, 20, 20, 20, 14, 16, 12],
                [ 12, 14, 12, 18, 18, 18, 12, 14, 12],
                [ 12, 18, 16, 22, 22, 22, 16, 18, 12],
                [ 12, 12, 12, 18, 18, 18, 12, 12, 12],
                [ 16, 20, 18, 24, 26, 24, 18, 20, 16],
                [ 14, 14, 12, 18, 16, 18, 12, 14, 14],
            ],
            advisor:  null,   // 士象留家守宮,位置不另外加分
            elephant: null,
            king:     null,
        };

        this._killers = [];
        this._nodes = 0;
        this._deadline = 0;
    }

    /* ---------- 走法產生 ---------- */

    /** 某一顆棋子的候選落點(只縮小搜尋範圍,合不合規矩仍然一律問 PiecesRules) */
    _candidateTargets(board, r, c) {
        const p = board[r][c];
        const out = [];
        const push = (tr, tc) => {
            if (tr >= 0 && tr < 10 && tc >= 0 && tc < 9) out.push([tr, tc]);
        };
        switch (p.type) {
            case 'king':
                push(r + 1, c); push(r - 1, c); push(r, c + 1); push(r, c - 1);
                for (let tr = 0; tr < 10; tr++) if (tr !== r) push(tr, c);   // 飛將
                break;
            case 'advisor':
                push(r + 1, c + 1); push(r + 1, c - 1); push(r - 1, c + 1); push(r - 1, c - 1);
                break;
            case 'elephant':
                push(r + 2, c + 2); push(r + 2, c - 2); push(r - 2, c + 2); push(r - 2, c - 2);
                break;
            case 'knight':
                push(r + 2, c + 1); push(r + 2, c - 1); push(r - 2, c + 1); push(r - 2, c - 1);
                push(r + 1, c + 2); push(r + 1, c - 2); push(r - 1, c + 2); push(r - 1, c - 2);
                break;
            case 'rook': case 'cannon':
                for (let tr = 0; tr < 10; tr++) if (tr !== r) push(tr, c);
                for (let tc = 0; tc < 9; tc++) if (tc !== c) push(r, tc);
                break;
            case 'pawn':
                push(r + 1, c); push(r - 1, c); push(r, c + 1); push(r, c - 1);
                break;
        }
        return out;
    }

    /** 偽合法走法(照走法規則,但還沒排除「走完自己被將」) */
    getPseudoMoves(board, color) {
        const moves = [];
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = board[r][c];
                if (!p || p.color !== color) continue;
                for (const t of this._candidateTargets(board, r, c)) {
                    const tr = t[0], tc = t[1];
                    const tgt = board[tr][tc];
                    if (tgt && tgt.color === color) continue;
                    if (!PiecesRules.checkRules(board, r, c, tr, tc)) continue;
                    moves.push({ from: { row: r, col: c }, to: { row: tr, col: tc } });
                }
            }
        }
        return moves;
    }

    findKing(board, color) {
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = board[r][c];
                if (p && p.type === 'king' && p.color === color) return { row: r, col: c };
            }
        }
        return null;
    }

    /** (r,c) 這一格會不會被 byColor 打到。★ 飛將也算:對方的帥直吃過來就是一種攻擊。 */
    isAttacked(board, r, c, byColor) {
        for (let er = 0; er < 10; er++) {
            for (let ec = 0; ec < 9; ec++) {
                const p = board[er][ec];
                if (!p || p.color !== byColor) continue;
                if (PiecesRules.checkRules(board, er, ec, r, c)) return true;
            }
        }
        return false;
    }

    isInCheck(board, color) {
        const k = this.findKing(board, color);
        if (!k) return false;
        return this.isAttacked(board, k.row, k.col, color === 'red' ? 'black' : 'red');
    }

    /** ★ 真正的合法走法:偽合法走法裡,把「走完自己的王還被打到」的全部丟掉。 */
    getAllLegalMoves(board, color) {
        const enemy = color === 'red' ? 'black' : 'red';
        const out = [];
        const pseudo = this.getPseudoMoves(board, color);
        for (let i = 0; i < pseudo.length; i++) {
            const mv = pseudo[i];
            const cap = this.makeSimulatedMove(board, mv);
            const k = this.findKing(board, color);
            const bad = k ? this.isAttacked(board, k.row, k.col, enemy) : false;
            this.undoSimulatedMove(board, mv, cap);
            if (!bad) out.push(mv);
        }
        return out;
    }

    makeSimulatedMove(board, move) {
        const cap = board[move.to.row][move.to.col];
        board[move.to.row][move.to.col] = board[move.from.row][move.from.col];
        board[move.from.row][move.from.col] = null;
        return cap;
    }

    undoSimulatedMove(board, move, cap) {
        board[move.from.row][move.from.col] = board[move.to.row][move.to.col];
        board[move.to.row][move.to.col] = cap;
    }

    /* ---------- 評估 ---------- */

    /** 一律「紅方為正」。回傳給 negamax 時再依走方變號。 */
    evaluateBoard(board) {
        let score = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = board[r][c];
                if (!p) continue;
                let v = this.PIECE_VALUES[p.type] || 0;
                const pst = this.PST[p.type];
                if (pst) v += p.color === 'red' ? pst[r][c] : pst[9 - r][c];
                score += p.color === 'red' ? v : -v;
            }
        }
        return score;
    }

    /* ---------- 搜尋 ---------- */

    _outOfTime() { return Date.now() >= this._deadline; }

    /** MVV-LVA:先試「用小子吃大子」,好的走法先試,alpha-beta 才剪得動。 */
    _orderMoves(board, moves, depth) {
        const killer = this._killers[depth];
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const victim = board[m.to.row][m.to.col];
            const mover = board[m.from.row][m.from.col];
            let s = 0;
            if (victim) {
                s = 10000 + (this.PIECE_VALUES[victim.type] || 0)
                          - (this.PIECE_VALUES[mover.type] || 0) / 10;
            } else if (killer && killer.from.row === m.from.row && killer.from.col === m.from.col
                              && killer.to.row === m.to.row && killer.to.col === m.to.col) {
                s = 9000;
            }
            m._s = s;
        }
        moves.sort((a, b) => b._s - a._s);
        return moves;
    }

    /** 靜態搜尋:只把「還有子可吃」的變化走完,免得剛好在吃子的半路上收工(水平線效應)。 */
    quiescence(board, alpha, beta, color, qdepth) {
        this._nodes++;
        const enemy = color === 'red' ? 'black' : 'red';
        const sign = color === 'red' ? 1 : -1;

        /* ★★ 2026-09-04 的致命 bug 就在這一段,記下來免得再犯:
           被將軍時不可以 stand pat(你沒有「不應將」這個選項)——這件事本身是對的。
           但第一版在「被將 + 沒有任何吃子能提高 alpha」時,直接 `return alpha`,
           而全窗搜尋傳進來的 alpha 是 -Infinity ⇒ 回傳 -Infinity ⇒
           父節點取負號變成 **+Infinity** ⇒ 引擎認定「只要能將軍就是必勝」,
           於是把車炮一路送去將軍,實測一盤丟光全部大子。
           ⇒ 一律用 fail-soft 的 best 記分,任何路徑都回傳「真的評估值」,永不回傳窗框本身。 */
        const inCheck = this.isInCheck(board, color);
        const stand = sign * this.evaluateBoard(board);

        let best;
        if (inCheck) {
            best = -this.MATE + 64;          // 沒有任何應法 ⇒ 被將死
        } else {
            best = stand;
            if (best >= beta) return best;
            if (best > alpha) alpha = best;
        }
        if (qdepth <= 0 || this._outOfTime()) return inCheck ? stand : best;

        /* ★ 搜尋內部一律用「偽合法走法 + 吃王即勝」,不做完整合法性檢查。
           完整檢查=每一步掃一次全盤 isAttacked,實測慢到深度 2 都到不了。
           偽合法 + 吃王即勝在語意上等價:走出送將的棋,對手下一層就把王吃掉拿 MATE。
           真正的合法性只在**根節點**做一次,所以交出去的那一手永遠是合法的。 */
        const all = this.getPseudoMoves(board, color);
        let tries;
        if (inCheck) {
            tries = all;                     // 被將:所有應法都要看,不能只看吃子
        } else {
            tries = [];
            for (let i = 0; i < all.length; i++) {
                if (board[all[i].to.row][all[i].to.col]) tries.push(all[i]);
            }
        }
        for (let i = 0; i < tries.length; i++) {
            const t = board[tries[i].to.row][tries[i].to.col];
            if (t && t.type === 'king') return this.MATE - 64;   // 直接把對方的王吃了
        }
        this._orderMoves(board, tries, 0);

        for (let i = 0; i < tries.length; i++) {
            const m = tries[i];
            const cap = this.makeSimulatedMove(board, m);
            const sc = -this.quiescence(board, -beta, -alpha, enemy, qdepth - 1);
            this.undoSimulatedMove(board, m, cap);
            if (sc > best) best = sc;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    }

    /** negamax + alpha-beta。ply=距離根節點幾層(用來把「早一點將死」排在前面)。 */
    search(board, depth, alpha, beta, color, ply) {
        this._nodes++;
        if (this._outOfTime()) return null;

        // 自己的王已經被吃掉了(上一層走了送將的棋)⇒ 輸
        if (!this.findKing(board, color)) return -this.MATE + ply;

        if (depth <= 0) return this.quiescence(board, alpha, beta, color, 4);

        const enemy = color === 'red' ? 'black' : 'red';
        const moves = this.getPseudoMoves(board, color);
        if (moves.length === 0) return -this.MATE + ply;    // 困斃:象棋算輸,不是和
        this._orderMoves(board, moves, depth);

        let best = -Infinity;
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const victim = board[m.to.row][m.to.col];
            if (victim && victim.type === 'king') return this.MATE - ply;   // 吃到王,直接勝
            const cap = this.makeSimulatedMove(board, m);
            const sc = this.search(board, depth - 1, -beta, -alpha, enemy, ply + 1);
            this.undoSimulatedMove(board, m, cap);
            if (sc === null) return null;                 // 時間到,這一層的結果不可信
            const val = -sc;
            if (val > best) best = val;
            if (val > alpha) alpha = val;
            if (alpha >= beta) {
                if (!cap) this._killers[depth] = m;        // 造成剪枝的非吃子步,下次先試
                break;
            }
        }
        return best;
    }

    /* ---------- 對外 ---------- */

    calculateBestMove(board, color, difficulty) {
        const lv = this.LEVELS[difficulty] || this.LEVELS.medium;
        const moves = this.getAllLegalMoves(board, color);
        if (moves.length === 0) return null;              // 將死或困斃,沒棋可走
        if (moves.length === 1) return moves[0];

        // 初級:留一點隨手,讓孩子有機會贏
        if (lv.blunder > 0 && Math.random() < lv.blunder) {
            return moves[Math.floor(Math.random() * moves.length)];
        }

        this._killers = [];
        this._nodes = 0;
        this._deadline = Date.now() + lv.ms;
        const enemy = color === 'red' ? 'black' : 'red';

        let scored = moves.map(function (m) { return { move: m, score: -Infinity }; });
        let completed = 0;

        /* 迭代加深:每一層都算完才採用,時間到就沿用上一層的結果。
           ★ 第 1 層一定要跑完(暫時關掉時間閘)—— 否則「一手都還沒評分就逾時」的時候,
              下面會從一堆 -Infinity 裡挑 pool[0],等於隨便走一步。
              這正是 2026-09-04 第一版對打淨虧 4700 分的真因。 */
        for (let d = 1; d <= lv.depth; d++) {
            const round = [];
            let alpha = -Infinity;
            let aborted = false;
            const savedDeadline = this._deadline;
            if (d === 1) this._deadline = Infinity;

            for (let i = 0; i < scored.length; i++) {     // 上一層的好棋先試
                const m = scored[i].move;
                const cap = this.makeSimulatedMove(board, m);
                const sc = this.search(board, d - 1, -Infinity, -alpha, enemy, 1);
                this.undoSimulatedMove(board, m, cap);
                if (sc === null) { aborted = true; break; }
                const val = -sc;
                round.push({ move: m, score: val });
                if (val > alpha) alpha = val;
            }
            if (d === 1) this._deadline = savedDeadline;

            /* 這一層沒跑完:已經評到分的那幾手仍然比上一層準(它們看得更深),
               把它們排到前面,其餘沿用上一層的排序,然後收工。 */
            if (aborted) {
                if (round.length) {
                    round.sort(function (a, b) { return b.score - a.score; });
                    const done = new Set(round.map(function (e) { return e.move; }));
                    scored = round.concat(scored.filter(function (e) { return !done.has(e.move); }));
                }
                break;
            }
            round.sort(function (a, b) { return b.score - a.score; });
            scored = round;
            completed = d;
            if (Math.abs(round[0].score) > this.MATE - 200) break;   // 算到殺棋就不用再深了
        }

        const bestScore = scored[0].score;
        /* 從「有評到分」的走法裡挑(沒評到分的一律不列入)。
           slack=0 時 pool 就只有同分的那幾手 ⇒ tieRandom 挑一個 = 有變化但不變弱。 */
        const pool = scored.filter(function (e) {
            return Number.isFinite(e.score) && e.score >= bestScore - lv.slack;
        });
        if (pool.length === 0) return scored[0].move;
        const pick = lv.tieRandom
            ? pool[Math.floor(Math.random() * pool.length)]
            : pool[0];                                    // 提示:固定挑最好那一手,同局面同答案

        if (typeof console !== 'undefined' && console.log) {
            console.log('AI ' + difficulty + ': depth ' + completed + '/' + lv.depth
                + ', ' + this._nodes + ' nodes, eval ' + bestScore);
        }
        return pick.move;
    }
}
