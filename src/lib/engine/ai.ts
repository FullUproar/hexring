// AI player — Minimax with alpha-beta pruning
// Designed to run in a Web Worker or on the main thread

import { Game } from "./game";
import { DIRS, hexDist } from "./hex";
import type { GameState, Move, Piece } from "./types";

export type AIDifficulty = 1 | 2 | 3 | 4 | 5 | 6;

const DEPTH_BY_LEVEL: Record<AIDifficulty, number> = {
  1: 0, // random
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
};

export function aiChooseMove(
  game: Game,
  state: GameState,
  difficulty: AIDifficulty = 4
): Move | null {
  const moves = game.allMoves(state);
  if (!moves.length) return null;

  // Level 1: random
  if (difficulty === 1) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Level 2+: minimax
  const depth = DEPTH_BY_LEVEL[difficulty];
  const aiPlayer = state.currentPlayer;

  orderMoves(moves);

  let bestScore = -Infinity;
  let bestMove: Move | null = null;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const m of moves) {
    const snap = game.snapshot(state);
    game.applyMove(state, m);
    const score = minimax(game, state, depth - 1, alpha, beta, false, aiPlayer);
    restoreState(state, snap);

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
    alpha = Math.max(alpha, bestScore);
  }

  return bestMove;
}

function minimax(
  game: Game,
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  aiPlayer: 0 | 1
): number {
  const w = game.checkWinner(state);
  if (w === aiPlayer) return 9999 + depth;
  if (w === (1 - aiPlayer)) return -9999 - depth;
  if (w === "draw") return 0;

  if (depth === 0) return evaluate(game, state, aiPlayer);

  const player = maximizing ? aiPlayer : ((1 - aiPlayer) as 0 | 1);
  const moves = game.allMoves(state, player);
  if (!moves.length) return evaluate(game, state, aiPlayer);

  orderMoves(moves);
  const maxBranch = depth >= 2 ? moves.length : Math.min(moves.length, 15);

  if (maximizing) {
    let value = -Infinity;
    for (let i = 0; i < maxBranch; i++) {
      const snap = game.snapshot(state);
      game.applyMove(state, moves[i]);
      value = Math.max(
        value,
        minimax(game, state, depth - 1, alpha, beta, false, aiPlayer)
      );
      restoreState(state, snap);
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  } else {
    let value = Infinity;
    for (let i = 0; i < maxBranch; i++) {
      const snap = game.snapshot(state);
      game.applyMove(state, moves[i]);
      value = Math.min(
        value,
        minimax(game, state, depth - 1, alpha, beta, true, aiPlayer)
      );
      restoreState(state, snap);
      beta = Math.min(beta, value);
      if (beta <= alpha) break;
    }
    return value;
  }
}

function evaluate(game: Game, state: GameState, aiPlayer: 0 | 1): number {
  const opp = (1 - aiPlayer) as 0 | 1;
  const myPieces = Object.values(state.pieces).filter(
    (p) => p.player === aiPlayer
  );
  const oppPieces = Object.values(state.pieces).filter(
    (p) => p.player === opp
  );
  const kt = game.board.config.killTarget;

  if (oppPieces.length === 0 || game.board.config.piecesPerPlayer - oppPieces.length >= kt)
    return 9999;
  if (myPieces.length === 0 || game.board.config.piecesPerPlayer - myPieces.length >= kt)
    return -9999;

  let score = 0;

  // Material
  score += (myPieces.length - oppPieces.length) * 200;

  // Positional evaluation
  for (const p of myPieces) {
    score += evalPiecePosition(game, state, p, opp, myPieces, oppPieces);
  }
  for (const p of oppPieces) {
    score -= evalPiecePosition(game, state, p, aiPlayer, oppPieces, myPieces);
  }

  return score;
}

function evalPiecePosition(
  game: Game,
  state: GameState,
  piece: Piece,
  enemyPlayer: 0 | 1,
  _allies: Piece[],
  enemies: Piece[]
): number {
  let score = 0;

  // Jump threats
  for (const [dq, dr] of DIRS) {
    const nq = piece.q + dq;
    const nr = piece.r + dr;
    const lq = nq + dq;
    const lr = nr + dr;
    const occ = Object.values(state.pieces).filter(
      (p) => p.q === nq && p.r === nr
    );
    if (
      occ.length &&
      occ[0].player === enemyPlayer &&
      game.board.onBoard(lq, lr) &&
      !Object.values(state.pieces).some((p) => p.q === lq && p.r === lr)
    ) {
      score += 40;
    }
  }

  // Distance to enemies
  let minD = 99;
  for (const op of enemies) {
    minD = Math.min(minD, hexDist(piece, op));
  }
  if (minD === 2) score += 15;
  else if (minD === 1) score += 8;
  else score -= minD * 3;

  // Edge penalty
  if (hexDist(piece, { q: 0, r: 0 }) === game.board.config.boardRadius) {
    score -= 8;
  }

  // Fortress bonus
  if (game.board.isFortress(piece.q, piece.r)) score += 3;

  // Vulnerability
  for (const [dq, dr] of DIRS) {
    const aq = piece.q + dq;
    const ar = piece.r + dr;
    const lq = piece.q - dq;
    const lr = piece.r - dr;
    const att = Object.values(state.pieces).filter(
      (p) => p.q === aq && p.r === ar
    );
    if (
      att.length &&
      att[0].player === enemyPlayer &&
      game.board.onBoard(lq, lr) &&
      !Object.values(state.pieces).some((p) => p.q === lq && p.r === lr)
    ) {
      score -= 25;
    }
  }

  return score;
}

function orderMoves(moves: Move[]): void {
  moves.sort((a, b) => {
    const sa =
      (a.type === "CHAIN_JUMP" ? (a.enemyKills || 0) * 3 : 0) +
      (a.type === "JUMP" && a.isCapture ? 2 : 0) +
      (a.type === "PUSH" ? 1 : 0);
    const sb =
      (b.type === "CHAIN_JUMP" ? (b.enemyKills || 0) * 3 : 0) +
      (b.type === "JUMP" && b.isCapture ? 2 : 0) +
      (b.type === "PUSH" ? 1 : 0);
    return sb - sa;
  });
}

function restoreState(state: GameState, snap: GameState): void {
  // Mutate state in-place from snapshot
  for (const id in state.pieces) delete state.pieces[id];
  for (const id in snap.pieces) {
    state.pieces[id] = { ...snap.pieces[id] };
  }
  state.nextPieceId = snap.nextPieceId;
  state.currentPlayer = snap.currentPlayer;
  state.winner = snap.winner;
  state.positionHistory = { ...snap.positionHistory };
  state.turnCount = snap.turnCount;
}
