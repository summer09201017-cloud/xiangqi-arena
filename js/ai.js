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
            /* 大師(2026-09-10 使用者:「加強AI的能力,可以AI也是最高級或大師級嗎」)——
               比高級再深兩層、多一倍思考時間;tieRandom:false(同分不亂挑,永遠走排序第一的
               那手,跟提示引擎一樣「該換就換」不摻隨機)。深度 8 已經比提示檔的 7 還深一層,
               是四檔裡搜最深、最不留情面的一檔。 */
            master: { depth: 8, ms: 2200, blunder: 0,    slack: 0,  tieRandom: false },
            /* tradeMargin(2026-09-07 使用者拍板,四站統一):提示不建議「白做工的交換」——
               吃子要比最好的安靜手多賺半個卒(50)才推薦,否則寧可建議走位。走 _hintRoot 那條路。
               ★ 只有提示有這條;AI 對手三檔照最強下法,該換就換,棋力不受影響。
               ★ 缺點誠實寫下來:少數「換掉對方關鍵防守子」的等價交換也會被跳過,提示因此偏保守。 */
            /* minDepth(2026-09-08 使用者實機退件「照提示走結果車被將吃了」):
               ★ 迭代加深「時間到就交出上一層」在**慢的裝置上會直接退化成 1 層**——
                 而 1 層 + quiescence 在時間也到了的時候連吃子鏈都不算(見 quiescence 的
                 _outOfTime 那一行)⇒ 水平線效應整個回來,提示就把子送到對方嘴邊。
                 實測:同一題同一手,桌機 1400ms 搜到 depth 5、手機那個速度只到 depth 1~2,
                 提示品質**跟著裝置速度變**,這種東西不能靠時間預算保證。
               ⇒ minDepth 這幾層無論多慢都要跑完(關掉時間閘),再往上才吃預算。
                 提示是使用者按一下才算一次,多等半秒可以接受;AI 對手不受這條影響。 */
            hint:   { depth: 7, ms: 1400, blunder: 0,    slack: 0,  tieRandom: false, tradeMargin: 50, minDepth: 3 },
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

    /* ══════════ 💡 提示的「子力關」(2026-09-07)══════════
       整體評估含 PST 位置分,一筆「子力打平、位置好看一點」的交換有可能靠位置分越過門檻。
       但使用者要的規矩很白話:**吃完被吃回、子力沒賺,就不要叫我吃**。
       所以提示另外用一份純子力的交換試算把關(不含 PST),兩關都過才推薦。 */

    /** 純子力(不含位置分),紅方為正 */
    _materialOnly(board) {
        let score = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = board[r][c];
                if (!p) continue;
                const v = this.PIECE_VALUES[p.type] || 0;
                score += p.color === 'red' ? v : -v;
            }
        }
        return score;
    }

    /** 只走吃子、只看子力,算到沒人想再吃(negamax:回傳值是 color 的視角) */
    _materialQuiescence(board, alpha, beta, color, qdepth) {
        const sign = color === 'red' ? 1 : -1;
        let best = sign * this._materialOnly(board);
        if (qdepth <= 0) return best;
        if (best >= beta) return best;
        if (best > alpha) alpha = best;

        const enemy = color === 'red' ? 'black' : 'red';
        const all = this.getPseudoMoves(board, color);
        const caps = [];
        for (let i = 0; i < all.length; i++) {
            const victim = board[all[i].to.row][all[i].to.col];
            if (!victim) continue;
            if (victim.type === 'king') return this.MATE;   // 吃到王=贏,不必再算
            caps.push(all[i]);
        }
        if (caps.length === 0) return best;
        this._orderMoves(board, caps, 0);

        for (let i = 0; i < caps.length; i++) {
            const m = caps[i];
            const cap = this.makeSimulatedMove(board, m);
            const sc = -this._materialQuiescence(board, -beta, -alpha, enemy, qdepth - 1);
            this.undoSimulatedMove(board, m, cap);
            if (sc > best) best = sc;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    }

    /** 走了這一手吃子之後,把交換算到底,對走棋方的淨子力(>0 賺、=0 等價、<0 虧) */
    _captureGain(board, move, color) {
        const victim = board[move.to.row][move.to.col];
        if (victim && victim.type === 'king') return Infinity;   // 吃王=直接贏,一定要推薦
        const sign = color === 'red' ? 1 : -1;
        const before = sign * this._materialOnly(board);
        const enemy = color === 'red' ? 'black' : 'red';
        const cap = this.makeSimulatedMove(board, move);
        const after = -this._materialQuiescence(board, -Infinity, Infinity, enemy, 6);
        this.undoSimulatedMove(board, move, cap);
        return after - before;
    }

    /* ══════════ 💡 提示專用的根層:兩段式(2026-09-07)══════════
       ★★ 為什麼不能沿用 calculateBestMove 的 scored 去比門檻(踩過一次,記下來):
          迭代加深的根層是 rising-alpha,窗是 (-Infinity, -alpha) ——
          **只有「有把 alpha 抬高」的那一手拿到精確分**,其餘全是「上界」(≥ 真值)。
          而 _orderMoves 把吃子排最前面 ⇒ 吃子先搜、先當冠軍,後面的安靜手拿到的是
          「貼著 alpha 的上界」⇒ 用它當門檻基準,門檻永遠比冠軍還高,任何吃子都過不了關。
          症狀:每一局都印「吃子 N 手裡 0 手值得推薦」,連白吃一支車都被擋掉。
       ⇒ 正解:**安靜手先搜**(rising alpha ⇒ 最好的安靜手是精確值),
          再用「安靜手 + 門檻」當吃子的起始 alpha ⇒ 能勝出的吃子也是精確值。
          每一手仍然只搜一次,成本和原本的根層一樣。 */
    _hintRoot(board, color, lv, moves) {
        const enemy = color === 'red' ? 'black' : 'red';
        const isCap = (m) => !!board[m.to.row][m.to.col];

        let quiet = [];
        const capsAll = [];
        for (let i = 0; i < moves.length; i++) {
            if (isCap(moves[i])) capsAll.push(moves[i]); else quiet.push(moves[i]);
        }
        let noisy = capsAll.slice();
        // 只剩吃子可走時,門檻沒有意義 —— 全部都當候選,不然沒棋可推薦
        if (quiet.length === 0) { quiet = capsAll.slice(); noisy = []; }
        this._orderMoves(board, noisy, 0);

        /* 子力關「按需計算」:_materialQuiescence 是全盤走法產生 × qdepth,不便宜。
           ★ 第一版在搜尋前先把每個吃子都算一遍 ⇒ 1400ms 預算被它吃光,
             迭代加深只跑得到 depth 1(log 印 "depth 1/7, 161 nodes" 就是這個症狀)。
           現在改成:只有當一手吃子的**分數已經越過門檻**、真的要被推薦時,才驗它的子力。
           典型只會呼叫 0~2 次。沒過關的不採用,也**不抬 alpha**(否則會擋掉後面合格的吃子)。 */
        const gainCache = new Map();
        const materialOk = (m) => {
            const key = m.from.row + ',' + m.from.col + '>' + m.to.row + ',' + m.to.col;
            if (!gainCache.has(key)) gainCache.set(key, this._captureGain(board, m, color) > 0);
            return gainCache.get(key);
        };

        let bestQuiet = quiet[0] || null;
        let bestNoisy = null;
        let completed = 0;
        let lastRound = [];        // 最後一層算完的安靜手排名(掉子關要拿它挑替代手)
        let sawMate = false;       // 這一手是殺棋 ⇒ 掉子關要放行(棄子殺是好棋)

        for (let d = 1; d <= lv.depth; d++) {
            const savedDeadline = this._deadline;
            if (d <= (lv.minDepth || 1)) this._deadline = Infinity;   // 這幾層一定跑完(第 1 層不跑完會從一堆 -Infinity 裡亂挑;minDepth 見 LEVELS.hint)
            let aborted = false;

            // ── 第一段:安靜手(rising alpha ⇒ 冠軍是精確值)──
            let alpha = -Infinity;
            let roundBest = null;
            const round = [];
            for (let i = 0; i < quiet.length; i++) {
                const m = quiet[i];
                const cap = this.makeSimulatedMove(board, m);
                const sc = this.search(board, d - 1, -Infinity, -alpha, enemy, 1);
                this.undoSimulatedMove(board, m, cap);
                if (sc === null) { aborted = true; break; }
                const val = -sc;
                round.push({ move: m, score: val });
                if (val > alpha) { alpha = val; roundBest = m; }
            }

            // ── 第二段:吃子,起始 alpha = 最好的安靜手 + 門檻 ──
            let noisyBest = null;
            let noisyScore = -Infinity;
            if (!aborted) {
                let nAlpha = quiet.length ? alpha + lv.tradeMargin : -Infinity;
                for (let i = 0; i < noisy.length; i++) {
                    const m = noisy[i];
                    const cap = this.makeSimulatedMove(board, m);
                    const sc = this.search(board, d - 1, -Infinity, -nAlpha, enemy, 1);
                    this.undoSimulatedMove(board, m, cap);
                    if (sc === null) { aborted = true; break; }
                    const val = -sc;
                    if (val > nAlpha && materialOk(m)) { nAlpha = val; noisyBest = m; noisyScore = val; }
                }
            }

            this._deadline = savedDeadline;
            if (aborted) break;                       // 這一層不完整,沿用上一層的結論

            if (roundBest) bestQuiet = roundBest;
            bestNoisy = noisyBest;                    // 只認這一層的結論(上一層的可能已被更深的推翻)
            completed = d;
            lastRound = round.slice();
            round.sort(function (a, b) { return b.score - a.score; });
            quiet = round.map(function (e) { return e.move; });   // 好手先搜,下一層剪得更兇
            /* 算到殺棋就不用再深了。★ 一定要先檢查是不是有限數:
               沒有吃子過門檻時 noisyScore 還是 -Infinity,而 Math.abs(-Infinity) > MATE 恆真
               ⇒ 每一局都在第 1 層就收工,提示等於只看一步(2026-09-07 實際踩到,
               log 印出一排 "depth 1/7, 100 nodes" 才發現)。 */
            const mateFound = (Number.isFinite(alpha) && Math.abs(alpha) > this.MATE - 200)
                || (Number.isFinite(noisyScore) && Math.abs(noisyScore) > this.MATE - 200);
            if (mateFound) { sawMate = true; break; }
        }

        let pick = bestNoisy || bestQuiet || moves[0];

        /* 🛡 掉子關(2026-09-08 使用者實機退件:「我按照 AI 提示去走,結果車被將吃了」)——
           交出去之前,用**純子力**(不含 PST 位置分)把這一手之後的吃子鏈算到底:
           會白丟半個卒以上的手,換成「分數次好、但不掉子」的那一手。
           ★ 為什麼位置分擋不住:一手把車送到對方將嘴邊,PST 可能因為「車進到對方陣地」
             給了正分;quiescence 本來要看穿它,但它在時間到的時候會退回靜態評估
             ⇒ 慢的裝置上就漏過去了。這一關只看子力、不吃時間閘,所以不會跟著裝置變。
           ★ 殺棋放行:棄子連殺是好棋,sawMate 的時候不擋。
           ★ 成本:_captureGain 是純子力 quiescence,只在「真的要交出去」時呼叫,最多 8 次。 */
        let rescued = null;
        if (pick && !sawMate) {
            const safe = (m) => this._captureGain(board, m, color) > -50;
            if (!safe(pick)) {
                const ranked = lastRound.slice().sort((a, b) => b.score - a.score);
                let tried = 0;
                for (let i = 0; i < ranked.length && tried < 8; i++) {
                    const m = ranked[i].move;
                    if (m === pick) continue;
                    tried++;
                    if (safe(m)) { rescued = m; break; }
                }
                if (rescued) pick = rescued;
            }
        }

        if (typeof console !== 'undefined' && console.log) {
            console.log('AI hint: depth ' + completed + '/' + lv.depth + ', ' + this._nodes
                + ' nodes;吃子 ' + capsAll.length + ' 手,驗過子力 ' + gainCache.size
                + ' 手,推薦吃子 ' + (bestNoisy ? '是' : '否')
                + (rescued ? ';🛡 掉子關換手' : ''));
        }
        return pick;
    }

    /* ══════════ 💡 提示②:必勝殺法搜尋(2026-09-08)══════════
       ★★ 為什麼一定要有這一段 —— 使用者 0908 實機退件:每日殘局「車馬兵」(3 手殺)
          照著提示走,走到第 7 手還在走,而且把車送去被將吃掉。
          病根不是「搜得不夠深」,是**提示不知道自己在解殘局**:
          殘局的勝利條件是「將死對方」,提示借的卻是對局引擎(子力 + PST 位置分),
          於是它在殘局裡追求「位置好看」——實測有一題的提示讓車在 (8,7)/(9,7) 之間
          來回跳針 15 手都不收(而正解是 4 手殺)。
       ⇒ 提示先問「有沒有算得完的必勝殺法」,有就走它、並且把「幾手殺」講出來;
         沒有才退回位置引擎,而且文案要誠實說「算不出必勝」。
       兩段式,便宜的先跑:
       ① 連將殺(每一手都將軍):分支極小,題庫的題本來就是這一型。
       ② 一般必勝殺(不強制將軍):給「已經走偏、連將殺不存在了」的局面用,只搜很淺。 */

    /** 攻方 color 要在 n 手內贏(將死或困斃)。allChecks=true 時每一手都必須將軍。
        回傳第一手,或 null。roots 可指定根層只考慮哪些手(UI 擋掉的長將不要推薦)。 */
    _mateAttack(board, color, n, allChecks, roots) {
        if (n <= 0 || this._outOfTime()) return null;
        const enemy = color === 'red' ? 'black' : 'red';
        const moves = roots || this.getAllLegalMoves(board, color);
        this._orderMoves(board, moves, 0);
        for (let i = 0; i < moves.length; i++) {
            if (this._outOfTime()) return null;
            const m = moves[i];
            const cap = this.makeSimulatedMove(board, m);
            let ok = false;
            /* 連將殺:這一手沒將軍就不算(題庫的題是這樣生的,而且分支小得多)。
               ⚠ 順序很重要 —— 先看有沒有將軍,再看對手有沒有棋:
                 不將軍卻讓對手無棋可走是「困斃」,象棋算贏,但那不是連將殺。 */
            if (allChecks && !this.isInCheck(board, enemy)) ok = false;
            else if (this.getAllLegalMoves(board, enemy).length === 0) ok = true;
            else if (n > 1) ok = this._mateDefend(board, enemy, n - 1, allChecks);
            this.undoSimulatedMove(board, m, cap);
            if (ok) return m;
        }
        return null;
    }

    /** 守方 color 走一手;攻方是否**不管他怎麼應**都能在 n 手內贏。 */
    _mateDefend(board, color, n, allChecks) {
        if (this._outOfTime()) return false;
        const enemy = color === 'red' ? 'black' : 'red';
        const moves = this.getAllLegalMoves(board, color);
        if (moves.length === 0) return true;                  // 已經沒棋可走 ⇒ 攻方贏了
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const cap = this.makeSimulatedMove(board, m);
            const stillWins = this._mateAttack(board, enemy, n, allChecks) !== null;
            this.undoSimulatedMove(board, m, cap);
            if (!stillWins) return false;                     // 有一招逃得掉 ⇒ 不是必勝
        }
        return true;
    }

    /** 迭代加深找**最短**必勝殺法。回傳 { move, mateIn, allChecks } 或 null。
        ⚠ 時間到就回 null —— 「算不出來」不等於「沒有殺法」,文案不可以混講。 */
    findForcedMate(board, color, opts) {
        const o = opts || {};
        const saved = this._deadline;
        this._deadline = Date.now() + (o.ms || 900);
        const roots = o.moves || this.getAllLegalMoves(board, color);
        let found = null;
        const maxN = Math.max(o.maxChecks || 0, o.maxAny || 0);
        for (let nn = 1; nn <= maxN && !found; nn++) {
            if (nn <= (o.maxChecks || 0)) {
                const m = this._mateAttack(board, color, nn, true, roots.slice());
                if (m) { found = { move: m, mateIn: nn, allChecks: true }; break; }
            }
            if (nn <= (o.maxAny || 0)) {
                const m = this._mateAttack(board, color, nn, false, roots.slice());
                if (m) { found = { move: m, mateIn: nn, allChecks: false }; break; }
            }
            if (this._outOfTime()) break;
        }
        this._deadline = saved;
        return found;
    }

    /* 💡 提示的對外入口(2026-09-08 起 app 一律走這裡,不要直接叫 calculateBestMove)。
       opts:
         puzzle      殘局模式 ⇒ 殺法搜得更深(殘局的勝利條件就是將死)
         rootFilter  (move)=>bool,由 app 傳進來的「UI 真的允許這一手嗎」
                     (長將被擋的棋提示出來,使用者會點不動、以為遊戲壞了)
       回傳 { move, kind, mateIn }:
         kind='mate' 找到必勝殺法(mateIn 手內)
         kind='best' 沒有算得完的殺法,這是位置引擎的最好一手(已過掉子關)
         kind='none' 沒有合法著法 */
    hintMove(board, color, opts) {
        const o = opts || {};
        let moves = this.getAllLegalMoves(board, color);
        if (typeof o.rootFilter === 'function') moves = moves.filter((m) => o.rootFilter(m));
        if (moves.length === 0) return { move: null, kind: 'none' };

        this._killers = [];
        this._nodes = 0;
        this._deadline = Infinity;

        if (moves.length === 1) return { move: moves[0], kind: 'best' };

        const mate = this.findForcedMate(board, color, {
            ms: o.puzzle ? 1500 : 450,
            maxChecks: o.puzzle ? 4 : 3,
            maxAny: o.puzzle ? 2 : 0,
            moves,
        });
        if (mate) {
            /* 🪧 sacrifice:這一手之後這顆會被吃掉。殺法裡棄子是常事(車換將位),
               但**一定要講**——使用者 0908 的原話就是「我按照 AI 提示去走,結果車被將吃了」:
               他不是不能接受棄子,他是不知道那是故意的。不講就等於提示在騙他。 */
            const sacrifice = this._captureGain(board, mate.move, color) <= -100;
            if (typeof console !== 'undefined' && console.log) {
                console.log('AI hint: 必勝殺法 ' + mate.mateIn + ' 手'
                    + (mate.allChecks ? '(連將殺)' : '(不必每手將軍)')
                    + (sacrifice ? ';這一手是棄子' : ''));
            }
            return {
                move: mate.move, kind: 'mate', mateIn: mate.mateIn,
                allChecks: mate.allChecks, sacrifice,
            };
        }

        const lv = this.LEVELS.hint;
        this._deadline = Date.now() + lv.ms;
        const move = this._hintRoot(board, color, lv, moves);
        return { move: move || moves[0], kind: 'best' };
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

        // 💡 提示走兩段式根層(不建議白做工的交換);AI 對手照舊走下面那條
        if (lv.tradeMargin) return this._hintRoot(board, color, lv, moves);

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
