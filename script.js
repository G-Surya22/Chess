const PIECE_SYMBOL = {
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟"
};

const FILES = "abcdefgh";
const KNIGHT_STEPS = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
const KING_STEPS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const diffEl = document.getElementById("difficulty");
const newGameBtn = document.getElementById("newGameBtn");
const flipBtn = document.getElementById("flipBtn");
const undoBtn = document.getElementById("undoBtn");
const whiteProbFillEl = document.getElementById("whiteProbFill");
const whiteProbTextEl = document.getElementById("whiteProbText");
const blackProbTextEl = document.getElementById("blackProbText");
const whiteLostPiecesEl = document.getElementById("whiteLostPieces");
const blackLostPiecesEl = document.getElementById("blackLostPieces");

let game = null;
let selected = null;
let legalTargets = [];
let boardFlipped = false;
let aiThinking = false;
let historyStack = [];
let aiTimerId = null;
const START_PIECE_COUNTS = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
const PIECE_DISPLAY_ORDER = ["Q", "R", "B", "N", "P"];

function createInitialBoard() {
  return [
    ["bR","bN","bB","bQ","bK","bB","bN","bR"],
    ["bP","bP","bP","bP","bP","bP","bP","bP"],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ["wP","wP","wP","wP","wP","wP","wP","wP"],
    ["wR","wN","wB","wQ","wK","wB","wN","wR"]
  ];
}

function newGame() {
  clearComputerTimer();

  game = {
    board: createInitialBoard(),
    turn: "w",
    mode: modeEl.value,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
    lastMove: null,
    result: null
  };

  selected = null;
  legalTargets = [];
  aiThinking = false;
  historyStack = [];

  render();
  maybeComputerMove();
}

function inside(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function colorOf(piece) {
  return piece ? piece[0] : null;
}

function typeOf(piece) {
  return piece ? piece[1] : null;
}

function isHumanTurn() {
  if (game.result) return false;
  if (game.mode === "pvp") return true;
  if (game.mode === "pvc-white") return game.turn === "w";
  return game.turn === "b";
}

function getDisplayRowCol(idx) {
  const r = Math.floor(idx / 8);
  const c = idx % 8;
  return boardFlipped ? [7 - r, 7 - c] : [r, c];
}

function squareName(r, c) {
  return `${FILES[c]}${8 - r}`;
}

function render() {
  boardEl.innerHTML = "";
  const checkKing = findKing(game.board, game.turn);

  for (let i = 0; i < 64; i++) {
    const [r, c] = getDisplayRowCol(i);
    const sq = document.createElement("div");
    const isLight = (r + c) % 2 === 0;
    let isFromLast = false;
    let isToLast = false;

    sq.className = `square ${isLight ? "light" : "dark"}`;
    sq.dataset.r = String(r);
    sq.dataset.c = String(c);

    if (selected && selected.r === r && selected.c === c) {
      sq.classList.add("selected");
    }

    if (legalTargets.some((m) => m.toR === r && m.toC === c)) {
      sq.classList.add("legal");
    }

    if (game.lastMove) {
      isFromLast = game.lastMove.fromR === r && game.lastMove.fromC === c;
      isToLast = game.lastMove.toR === r && game.lastMove.toC === c;
      if (isFromLast || isToLast) sq.classList.add("last-move");
      if (isFromLast) sq.classList.add("last-from");
      if (isToLast) sq.classList.add("last-to");
    }

    if (checkKing && checkKing.r === r && checkKing.c === c && inCheck(game.board, game.turn, game.castling, game.enPassant)) {
      sq.classList.add("in-check");
    }

    const piece = game.board[r][c];
    if (piece) {
      const pieceEl = document.createElement("span");
      pieceEl.className = `piece ${colorOf(piece) === "w" ? "white" : "black"}`;
      if (isToLast) pieceEl.classList.add("arrive");
      pieceEl.textContent = PIECE_SYMBOL[typeOf(piece)];
      sq.appendChild(pieceEl);
    }

    if ((!boardFlipped && r === 7) || (boardFlipped && r === 0)) {
      const coord = document.createElement("span");
      coord.className = "coord file";
      coord.textContent = FILES[c];
      sq.appendChild(coord);
    }

    if ((!boardFlipped && c === 0) || (boardFlipped && c === 7)) {
      const coord = document.createElement("span");
      coord.className = "coord rank";
      coord.textContent = String(8 - r);
      sq.appendChild(coord);
    }

    sq.addEventListener("click", onSquareClick);
    boardEl.appendChild(sq);
  }

  statusEl.textContent = buildStatusText();
  if (undoBtn) undoBtn.disabled = historyStack.length === 0;
  renderInsights();
}

function renderInsights() {
  if (!whiteProbFillEl || !whiteProbTextEl || !blackProbTextEl || !whiteLostPiecesEl || !blackLostPiecesEl) return;

  const whiteProb = estimateWhiteWinProbability();
  const blackProb = 1 - whiteProb;

  whiteProbFillEl.style.width = `${Math.round(whiteProb * 100)}%`;
  whiteProbTextEl.textContent = `White ${Math.round(whiteProb * 100)}%`;
  blackProbTextEl.textContent = `Black ${Math.round(blackProb * 100)}%`;

  renderLostPieces(whiteLostPiecesEl, "w");
  renderLostPieces(blackLostPiecesEl, "b");
}

function estimateWhiteWinProbability() {
  if (game.result) {
    if (game.result.includes("White wins")) return 1;
    if (game.result.includes("Black wins")) return 0;
    return 0.5;
  }

  const score = evaluate(game.board);
  const clamped = Math.max(-2500, Math.min(2500, score));
  return 1 / (1 + Math.exp(-clamped / 500));
}

function countPiecesByType(board, color) {
  const counts = { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && colorOf(piece) === color) {
        counts[typeOf(piece)] += 1;
      }
    }
  }
  return counts;
}

function renderLostPieces(container, color) {
  container.innerHTML = "";
  const current = countPiecesByType(game.board, color);
  const fragment = document.createDocumentFragment();
  let lostCount = 0;

  for (const type of PIECE_DISPLAY_ORDER) {
    const lost = Math.max(0, START_PIECE_COUNTS[type] - current[type]);
    for (let i = 0; i < lost; i++) {
      const span = document.createElement("span");
      span.className = `piece captured-piece ${color === "w" ? "white" : "black"}`;
      span.textContent = PIECE_SYMBOL[type];
      fragment.appendChild(span);
      lostCount += 1;
    }
  }

  if (lostCount === 0) {
    container.textContent = "None";
    return;
  }

  container.appendChild(fragment);
}
function buildStatusText() {
  if (game.result) return game.result;
  if (aiThinking) return "Computer is thinking...";
  const side = game.turn === "w" ? "White" : "Black";
  if (inCheck(game.board, game.turn, game.castling, game.enPassant)) {
    return `${side} to move - Check`;
  }
  return `${side} to move`;
}

function onSquareClick(e) {
  if (!isHumanTurn() || aiThinking) return;

  const target = e.currentTarget;
  const r = Number(target.dataset.r);
  const c = Number(target.dataset.c);
  const piece = game.board[r][c];

  if (selected) {
    const move = legalTargets.find((m) => m.toR === r && m.toC === c);
    if (move) {
      commitMove(move);
      selected = null;
      legalTargets = [];
      return;
    }
  }

  if (!piece || colorOf(piece) !== game.turn) {
    selected = null;
    legalTargets = [];
    render();
    return;
  }

  selected = { r, c };
  legalTargets = legalMovesForSquare(game, r, c);
  render();
}

function cloneState(state) {
  return {
    board: state.board.map((row) => [...row]),
    turn: state.turn,
    mode: state.mode,
    castling: { ...state.castling },
    enPassant: state.enPassant ? { ...state.enPassant } : null,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    result: state.result
  };
}

function clearComputerTimer() {
  if (aiTimerId !== null) {
    window.clearTimeout(aiTimerId);
    aiTimerId = null;
  }
}

function commitMove(move) {
  historyStack.push(cloneState(game));
  applyMove(game, move);
  finalizeTurn();
}

function restorePreviousState() {
  const previous = historyStack.pop();
  if (!previous) return false;

  game = previous;
  selected = null;
  legalTargets = [];
  aiThinking = false;
  return true;
}

function undoMove() {
  if (historyStack.length === 0) return;

  clearComputerTimer();
  if (!restorePreviousState()) return;

  if (game.mode !== "pvp") {
    while (!isHumanTurn() && historyStack.length > 0) {
      if (!restorePreviousState()) break;
    }
  }

  render();

  if (!isHumanTurn()) {
    maybeComputerMove();
  }
}

function legalMovesForSquare(state, r, c) {
  const piece = state.board[r][c];
  if (!piece || colorOf(piece) !== state.turn) return [];

  const pseudo = pseudoMoves(state, r, c, true);
  return pseudo.filter((m) => {
    const copy = cloneState(state);
    applyMove(copy, m, true);
    return !inCheck(copy.board, state.turn, copy.castling, copy.enPassant);
  });
}

function allLegalMoves(state) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (colorOf(state.board[r][c]) === state.turn) {
        moves.push(...legalMovesForSquare(state, r, c));
      }
    }
  }
  return moves;
}

function pseudoMoves(state, r, c, includeCastling = false) {
  const board = state.board;
  const piece = board[r][c];
  const type = typeOf(piece);
  const color = colorOf(piece);
  const enemy = color === "w" ? "b" : "w";
  const out = [];

  const addSlide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (inside(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          out.push({ fromR: r, fromC: c, toR: nr, toC: nc });
        } else {
          if (colorOf(target) === enemy) out.push({ fromR: r, fromC: c, toR: nr, toC: nc });
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  };

  if (type === "P") {
    const dir = color === "w" ? -1 : 1;
    const startRank = color === "w" ? 6 : 1;
    const promoteRank = color === "w" ? 0 : 7;

    const oneR = r + dir;
    if (inside(oneR, c) && !board[oneR][c]) {
      if (oneR === promoteRank) {
        for (const promo of ["Q","R","B","N"]) {
          out.push({ fromR: r, fromC: c, toR: oneR, toC: c, promotion: promo });
        }
      } else {
        out.push({ fromR: r, fromC: c, toR: oneR, toC: c });
      }

      const twoR = r + 2 * dir;
      if (r === startRank && !board[twoR][c]) {
        out.push({ fromR: r, fromC: c, toR: twoR, toC: c, doublePawn: true });
      }
    }

    for (const dc of [-1, 1]) {
      const nr = r + dir;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const target = board[nr][nc];

      if (target && colorOf(target) === enemy) {
        if (nr === promoteRank) {
          for (const promo of ["Q","R","B","N"]) {
            out.push({ fromR: r, fromC: c, toR: nr, toC: nc, promotion: promo });
          }
        } else {
          out.push({ fromR: r, fromC: c, toR: nr, toC: nc });
        }
      }

      if (state.enPassant && state.enPassant.r === nr && state.enPassant.c === nc) {
        out.push({ fromR: r, fromC: c, toR: nr, toC: nc, enPassant: true });
      }
    }
  }

  if (type === "N") {
    for (const [dr, dc] of KNIGHT_STEPS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target || colorOf(target) !== color) {
        out.push({ fromR: r, fromC: c, toR: nr, toC: nc });
      }
    }
  }

  if (type === "B") addSlide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  if (type === "R") addSlide([[1,0],[-1,0],[0,1],[0,-1]]);
  if (type === "Q") addSlide([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]);

  if (type === "K") {
    for (const [dr, dc] of KING_STEPS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target || colorOf(target) !== color) {
        out.push({ fromR: r, fromC: c, toR: nr, toC: nc });
      }
    }

    if (includeCastling && !inCheck(board, color, state.castling, state.enPassant)) {
      const back = color === "w" ? 7 : 0;
      const enemyColor = color === "w" ? "b" : "w";

      if ((color === "w" ? state.castling.wK : state.castling.bK) &&
          !board[back][5] && !board[back][6] &&
          !isSquareAttacked(board, back, 5, enemyColor) &&
          !isSquareAttacked(board, back, 6, enemyColor)) {
        out.push({ fromR: r, fromC: c, toR: back, toC: 6, castle: "K" });
      }

      if ((color === "w" ? state.castling.wQ : state.castling.bQ) &&
          !board[back][1] && !board[back][2] && !board[back][3] &&
          !isSquareAttacked(board, back, 2, enemyColor) &&
          !isSquareAttacked(board, back, 3, enemyColor)) {
        out.push({ fromR: r, fromC: c, toR: back, toC: 2, castle: "Q" });
      }
    }
  }

  return out;
}

function applyMove(state, move, simulation = false) {
  const board = state.board;
  const piece = board[move.fromR][move.fromC];
  const color = colorOf(piece);
  const type = typeOf(piece);

  const captured = move.enPassant
    ? board[move.fromR][move.toC]
    : board[move.toR][move.toC];

  board[move.fromR][move.fromC] = null;
  board[move.toR][move.toC] = piece;

  if (move.enPassant) {
    board[move.fromR][move.toC] = null;
  }

  if (move.promotion) {
    board[move.toR][move.toC] = `${color}${move.promotion}`;
  }

  if (move.castle) {
    const row = color === "w" ? 7 : 0;
    if (move.castle === "K") {
      board[row][5] = board[row][7];
      board[row][7] = null;
    } else {
      board[row][3] = board[row][0];
      board[row][0] = null;
    }
  }

  updateCastlingRights(state, move, piece, captured);

  if (move.doublePawn) {
    state.enPassant = { r: (move.fromR + move.toR) / 2, c: move.fromC };
  } else {
    state.enPassant = null;
  }

  if (type === "P" || captured) {
    state.halfmove = 0;
  } else {
    state.halfmove += 1;
  }

  state.lastMove = { ...move };

  if (state.turn === "b") state.fullmove += 1;
  state.turn = state.turn === "w" ? "b" : "w";

  if (!simulation) render();
}

function updateCastlingRights(state, move, piece, captured) {
  const type = typeOf(piece);
  const color = colorOf(piece);

  if (type === "K") {
    if (color === "w") {
      state.castling.wK = false;
      state.castling.wQ = false;
    } else {
      state.castling.bK = false;
      state.castling.bQ = false;
    }
  }

  if (type === "R") {
    if (move.fromR === 7 && move.fromC === 0) state.castling.wQ = false;
    if (move.fromR === 7 && move.fromC === 7) state.castling.wK = false;
    if (move.fromR === 0 && move.fromC === 0) state.castling.bQ = false;
    if (move.fromR === 0 && move.fromC === 7) state.castling.bK = false;
  }

  if (captured && typeOf(captured) === "R") {
    if (move.toR === 7 && move.toC === 0) state.castling.wQ = false;
    if (move.toR === 7 && move.toC === 7) state.castling.wK = false;
    if (move.toR === 0 && move.toC === 0) state.castling.bQ = false;
    if (move.toR === 0 && move.toC === 7) state.castling.bK = false;
  }
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === `${color}K`) return { r, c };
    }
  }
  return null;
}

function isSquareAttacked(board, r, c, byColor) {
  const dir = byColor === "w" ? -1 : 1;

  for (const dc of [-1, 1]) {
    const pr = r - dir;
    const pc = c + dc;
    if (inside(pr, pc) && board[pr][pc] === `${byColor}P`) return true;
  }

  for (const [dr, dc] of KNIGHT_STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (inside(nr, nc) && board[nr][nc] === `${byColor}N`) return true;
  }

  for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    let nr = r + dr;
    let nc = c + dc;
    while (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === "R" || typeOf(p) === "Q")) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    let nr = r + dr;
    let nc = c + dc;
    while (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === "B" || typeOf(p) === "Q")) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  for (const [dr, dc] of KING_STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (inside(nr, nc) && board[nr][nc] === `${byColor}K`) return true;
  }

  return false;
}

function inCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return false;
  const enemy = color === "w" ? "b" : "w";
  return isSquareAttacked(board, king.r, king.c, enemy);
}

function finalizeTurn() {
  const moves = allLegalMoves(game);
  const side = game.turn === "w" ? "White" : "Black";

  if (moves.length === 0) {
    if (inCheck(game.board, game.turn, game.castling, game.enPassant)) {
      const winner = game.turn === "w" ? "Black" : "White";
      game.result = `Checkmate - ${winner} wins`;
    } else {
      game.result = "Draw - Stalemate";
    }
    render();
    return;
  }

  if (game.halfmove >= 100) {
    game.result = "Draw - 50-move rule";
    render();
    return;
  }

  render();
  maybeComputerMove();
}

function evaluate(board) {
  const pieceValue = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const val = pieceValue[typeOf(p)] + positionalBonus(p, r, c);
      score += colorOf(p) === "w" ? val : -val;
    }
  }

  return score;
}

function positionalBonus(piece, r, c) {
  const type = typeOf(piece);
  const color = colorOf(piece);
  const rr = color === "w" ? r : 7 - r;
  const center = (3.5 - Math.abs(3.5 - c)) + (3.5 - Math.abs(3.5 - rr));

  if (type === "P") return (6 - rr) * 5;
  if (type === "N" || type === "B") return Math.floor(center * 4);
  if (type === "K") return -Math.floor(center * 2);
  return Math.floor(center * 2);
}

function bestMove(state, depth) {
  const maximizing = state.turn === "w";
  let best = null;
  let bestScore = maximizing ? -Infinity : Infinity;

  const moves = allLegalMoves(state);
  shuffle(moves);

  for (const mv of moves) {
    const copy = cloneState(state);
    applyMove(copy, mv, true);
    const score = minimax(copy, depth - 1, -Infinity, Infinity);

    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      best = mv;
    }
  }

  return best;
}

function minimax(state, depth, alpha, beta) {
  const moves = allLegalMoves(state);

  if (depth === 0 || moves.length === 0) {
    if (moves.length === 0) {
      if (inCheck(state.board, state.turn, state.castling, state.enPassant)) {
        return state.turn === "w" ? -99999 : 99999;
      }
      return 0;
    }
    return evaluate(state.board);
  }

  const maximizing = state.turn === "w";

  if (maximizing) {
    let value = -Infinity;
    for (const mv of moves) {
      const copy = cloneState(state);
      applyMove(copy, mv, true);
      value = Math.max(value, minimax(copy, depth - 1, alpha, beta));
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }

  let value = Infinity;
  for (const mv of moves) {
    const copy = cloneState(state);
    applyMove(copy, mv, true);
    value = Math.min(value, minimax(copy, depth - 1, alpha, beta));
    beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function maybeComputerMove() {
  if (game.result || game.mode === "pvp" || aiThinking) return;

  const computerColor = game.mode === "pvc-white" ? "b" : "w";
  if (game.turn !== computerColor) return;

  aiThinking = true;
  render();

  const depth = Number(diffEl.value);
  const aiDelay = 3000;

  clearComputerTimer();
  aiTimerId = window.setTimeout(() => {
    aiTimerId = null;
    const mv = bestMove(game, depth);
    aiThinking = false;

    if (!mv) {
      finalizeTurn();
      return;
    }

    commitMove(mv);
  }, aiDelay);
}

modeEl.addEventListener("change", newGame);
diffEl.addEventListener("change", () => {
  if (!game || game.mode === "pvp") return;
  maybeComputerMove();
});

newGameBtn.addEventListener("click", newGame);
undoBtn.addEventListener("click", undoMove);
flipBtn.addEventListener("click", () => {
  boardFlipped = !boardFlipped;
  render();
});

newGame();




