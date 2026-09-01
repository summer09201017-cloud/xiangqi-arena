// js/pieces.js - 棋子走法規則實作

const PiecesRules = {
    checkRules(board, fr, fc, tr, tc) {
        const piece = board[fr][fc];
        const color = piece.color;
        
        const dr = Math.abs(tr - fr);
        const dc = Math.abs(tc - fc);

        switch (piece.type) {
            case 'king':
                // 只能在九宮格內走，每次一格，直線或橫線
                if (dr + dc !== 1) {
                    // 飛將規則：如果目標是對方的王，且在同一條直線上，且中間沒有其他棋子
                    const targetPiece = board[tr][tc];
                    if (targetPiece && targetPiece.type === 'king' && fc === tc) {
                        if (this.countPiecesBetween(board, fr, fc, tr, tc) === 0) {
                            return true;
                        }
                    }
                    return false;
                }
                if (!this.isInPalace(color, tr, tc)) return false;
                return true;

            case 'advisor':
                // 只能在九宮格內斜走一格
                if (dr !== 1 || dc !== 1) return false;
                if (!this.isInPalace(color, tr, tc)) return false;
                return true;

            case 'elephant':
                // 田字，不能過河，不能塞象眼
                if (dr !== 2 || dc !== 2) return false;
                if (color === 'red' && tr > 4) return false; // 紅相不過河
                if (color === 'black' && tr < 5) return false; // 黑象不過河
                // 檢查象眼
                const eyeR = (fr + tr) / 2;
                const eyeC = (fc + tc) / 2;
                if (board[eyeR][eyeC] !== null) return false;
                return true;

            case 'knight':
                // 日字，不能絆馬腳
                if (!((dr === 2 && dc === 1) || (dr === 1 && dc === 2))) return false;
                // 檢查馬腳
                if (dr === 2) { // 垂直方向長
                    const footR = fr + (tr - fr) / 2;
                    if (board[footR][fc] !== null) return false;
                } else { // 水平方向長
                    const footC = fc + (tc - fc) / 2;
                    if (board[fr][footC] !== null) return false;
                }
                return true;

            case 'rook':
                // 直線或橫線，中間不能有子
                if (fr !== tr && fc !== tc) return false;
                if (this.countPiecesBetween(board, fr, fc, tr, tc) > 0) return false;
                return true;

            case 'cannon':
                // 直線或橫線
                if (fr !== tr && fc !== tc) return false;
                const piecesBetween = this.countPiecesBetween(board, fr, fc, tr, tc);
                const targetPieceC = board[tr][tc];
                
                if (targetPieceC) {
                    // 吃子時中間必須剛好有一個子 (炮架)
                    return piecesBetween === 1;
                } else {
                    // 不吃子時中間不能有子
                    return piecesBetween === 0;
                }

            case 'pawn':
                // 未過河只能往前一格，過河後可以左右或往前一格。不能後退。
                const dir = color === 'red' ? 1 : -1; // 紅方 row 增加方向往前，黑方減少
                const hasCrossedRiver = color === 'red' ? fr >= 5 : fr <= 4;
                
                if (!hasCrossedRiver) {
                    return (tr - fr) === dir && dc === 0;
                } else {
                    if ((tr - fr) === dir && dc === 0) return true; // 往前一格
                    if (dr === 0 && dc === 1) return true; // 左右一格
                    return false;
                }
                
            default:
                return false;
        }
    },

    isInPalace(color, r, c) {
        if (c < 3 || c > 5) return false;
        if (color === 'red') {
            return r >= 0 && r <= 2;
        } else {
            return r >= 7 && r <= 9;
        }
    },

    countPiecesBetween(board, r1, c1, r2, c2) {
        let count = 0;
        if (r1 === r2) {
            const minC = Math.min(c1, c2);
            const maxC = Math.max(c1, c2);
            for (let c = minC + 1; c < maxC; c++) {
                if (board[r1][c] !== null) count++;
            }
        } else if (c1 === c2) {
            const minR = Math.min(r1, r2);
            const maxR = Math.max(r1, r2);
            for (let r = minR + 1; r < maxR; r++) {
                if (board[r][c1] !== null) count++;
            }
        }
        return count;
    }
};