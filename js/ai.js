// js/ai.js - AI 邏輯與 Minimax 演算法

class ChessAI {
    constructor() {
        // 棋子基礎價值評估
        this.PIECE_VALUES = {
            'king': 10000,
            'rook': 900,
            'cannon': 450,
            'knight': 400,
            'advisor': 200,
            'elephant': 200,
            'pawn': 100
        };
    }

    // 取得所有合法走法 (簡化版，不考慮將軍/被將軍的深層邏輯以提升速度)
    getAllLegalMoves(board, color) {
        const moves = [];
        for (let fr = 0; fr < 10; fr++) {
            for (let fc = 0; fc < 9; fc++) {
                const piece = board[fr][fc];
                if (piece && piece.color === color) {
                    for (let tr = 0; tr < 10; tr++) {
                        for (let tc = 0; tc < 9; tc++) {
                            const target = board[tr][tc];
                            if (target && target.color === color) continue; // 不能吃自己人
                            if (PiecesRules.checkRules(board, fr, fc, tr, tc)) {
                                moves.push({
                                    from: { row: fr, col: fc },
                                    to: { row: tr, col: tc }
                                });
                            }
                        }
                    }
                }
            }
        }
        return moves;
    }

    // 評估函數 (Evaluation Function)
    evaluateBoard(board) {
        let score = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = board[r][c];
                if (piece) {
                    let val = this.PIECE_VALUES[piece.type];
                    // 簡單的位置加成：兵過河後價值增加
                    if (piece.type === 'pawn') {
                        const hasCrossed = piece.color === 'red' ? r >= 5 : r <= 4;
                        if (hasCrossed) val += 50;
                    }
                    
                    if (piece.color === 'black') {
                        score += val; // AI 是黑方，希望分數越高越好
                    } else {
                        score -= val;
                    }
                }
            }
        }
        return score;
    }

    // 模擬移動棋子
    makeSimulatedMove(board, move) {
        const capturedPiece = board[move.to.row][move.to.col];
        board[move.to.row][move.to.col] = board[move.from.row][move.from.col];
        board[move.from.row][move.from.col] = null;
        return capturedPiece;
    }

    // 復原模擬移動
    undoSimulatedMove(board, move, capturedPiece) {
        board[move.from.row][move.from.col] = board[move.to.row][move.to.col];
        board[move.to.row][move.to.col] = capturedPiece;
    }

    // Minimax with Alpha-Beta Pruning
    minimax(board, depth, alpha, beta, isMaximizingPlayer) {
        if (depth === 0) {
            return this.evaluateBoard(board);
        }

        const color = isMaximizingPlayer ? 'black' : 'red';
        const moves = this.getAllLegalMoves(board, color);
        
        // 簡單勝負判定：如果沒走法了 (王被吃或困斃)
        if (moves.length === 0) {
            return isMaximizingPlayer ? -99999 : 99999;
        }

        if (isMaximizingPlayer) {
            let maxEval = -Infinity;
            for (let move of moves) {
                const captured = this.makeSimulatedMove(board, move);
                // 如果吃掉王，直接回傳高分
                if (captured && captured.type === 'king') {
                    this.undoSimulatedMove(board, move, captured);
                    return 99999;
                }
                const ev = this.minimax(board, depth - 1, alpha, beta, false);
                this.undoSimulatedMove(board, move, captured);
                maxEval = Math.max(maxEval, ev);
                alpha = Math.max(alpha, ev);
                if (beta <= alpha) break; // Beta 剪枝
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (let move of moves) {
                const captured = this.makeSimulatedMove(board, move);
                if (captured && captured.type === 'king') {
                    this.undoSimulatedMove(board, move, captured);
                    return -99999;
                }
                const ev = this.minimax(board, depth - 1, alpha, beta, true);
                this.undoSimulatedMove(board, move, captured);
                minEval = Math.min(minEval, ev);
                beta = Math.min(beta, ev);
                if (beta <= alpha) break; // Alpha 剪枝
            }
            return minEval;
        }
    }

    calculateBestMove(board, color, difficulty) {
        // AI 預設扮演黑方 (Maximizing player in evaluation)
        // 這裡確保通用性，但預設邏輯是黑方為 AI
        
        let depth = 1;
        if (difficulty === 'easy') depth = 1; // 隨機或深度1
        else if (difficulty === 'medium') depth = 2; // 深度2
        else if (difficulty === 'hard') depth = 3; // 深度3

        const moves = this.getAllLegalMoves(board, color);
        if (moves.length === 0) return null;

        if (difficulty === 'easy' && Math.random() < 0.3) {
            // 初級難度有一定機率隨機走，增加變化
            return moves[Math.floor(Math.random() * moves.length)];
        }

        let bestMove = null;
        let bestValue = color === 'black' ? -Infinity : Infinity;

        // 洗牌以避免總是走同樣的步
        moves.sort(() => Math.random() - 0.5);

        const startTime = performance.now();

        for (let move of moves) {
            const captured = this.makeSimulatedMove(board, move);
            let moveValue;
            
            if (captured && captured.type === 'king') {
                moveValue = color === 'black' ? 99999 : -99999; // 直接勝利步
            } else {
                moveValue = this.minimax(board, depth - 1, -Infinity, Infinity, color !== 'black');
            }
            
            this.undoSimulatedMove(board, move, captured);

            if (color === 'black') {
                if (moveValue > bestValue) {
                    bestValue = moveValue;
                    bestMove = move;
                }
            } else {
                if (moveValue < bestValue) {
                    bestValue = moveValue;
                    bestMove = move;
                }
            }
        }
        
        console.log(`AI thought for ${(performance.now() - startTime).toFixed(2)}ms, depth: ${depth}, eval: ${bestValue}`);
        
        return bestMove || moves[0]; // Fallback to first move if something goes wrong
    }
}