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

  const aiPlayer = state.currentPlayer;

  // --- Tactical override (difficulty 3+): instant win / loss detection ---
  if (difficulty >= 3) {
    // 1. Check for instant wins — take them immediately, no softmax
    const winningMoves: Move[] = [];
    for (const m of moves) {
      const snap = game.snapshot(state);
      game.applyMove(state, m);
      const w = game.checkWinner(state);
      restoreState(state, snap);
      if (w === aiPlayer) winningMoves.push(m);
    }
    if (winningMoves.length) {
      return winningMoves[Math.floor(Math.random() * winningMoves.length)];
    }

    // 2. Check if opponent has an instant win next turn — avoid moves that allow it
    // For each of our moves, simulate it, then check if opponent can win
    const opp = (1 - aiPlayer) as 0 | 1;
    const safeFlags: boolean[] = [];
    for (const m of moves) {
      const snap = game.snapshot(state);
      game.applyMove(state, m);
      // Switch to opponent's turn to check their responses
      state.currentPlayer = opp;
      const oppMoves = game.allMoves(state, opp);
      let oppCanWin = false;
      for (const om of oppMoves) {
        const snap2 = game.snapshot(state);
        game.applyMove(state, om);
        if (game.checkWinner(state) === opp) oppCanWin = true;
        restoreState(state, snap2);
        if (oppCanWin) break;
      }
      restoreState(state, snap);
      safeFlags.push(!oppCanWin);
    }
    // If some moves are safe and some aren't, filter to only safe moves
    const hasSafe = safeFlags.some((s) => s);
    const hasUnsafe = safeFlags.some((s) => !s);
    if (hasSafe && hasUnsafe) {
      // Remove unsafe moves from consideration
      const safeMoves = moves.filter((_, i) => safeFlags[i]);
      // Continue to minimax with only safe moves
      return aiMinimaxPick(game, state, safeMoves, difficulty, aiPlayer);
    }
  }

  return aiMinimaxPick(game, state, moves, difficulty, aiPlayer);
}

function aiMinimaxPick(
  game: Game,
  state: GameState,
  moves: Move[],
  difficulty: AIDifficulty,
  aiPlayer: 0 | 1
): Move | null {
  const depth = DEPTH_BY_LEVEL[difficulty];

  orderMoves(moves);

  const scored: { move: Move; score: number }[] = [];
  let alpha = -Infinity;
  const beta = Infinity;

  for (const m of moves) {
    const snap = game.snapshot(state);
    game.applyMove(state, m);

    let score = minimax(game, state, depth - 1, alpha, beta, false, aiPlayer);

    // Penalize moves that lead toward threefold repetition
    if (game.board.config.threefoldRepetition) {
      const pcs = Object.values(state.pieces)
        .map((p) => `${p.player},${p.q},${p.r}`)
        .sort();
      const h = pcs.join("|") + ":" + ((1 - aiPlayer) as 0 | 1);
      const reps = state.positionHistory[h] || 0;
      if (reps >= 2) {
        score = drawScore(game, state, aiPlayer);
      } else if (reps >= 1) {
        score -= 150;
      }
    }

    restoreState(state, snap);
    scored.push({ move: m, score });
    alpha = Math.max(alpha, score);
  }

  // Softmax-style selection: pick from top moves with weighted randomness
  // Higher difficulty = tighter temperature (more deterministic but still varied)
  return softmaxPick(scored, difficulty);
}

function softmaxPick(
  scored: { move: Move; score: number }[],
  difficulty: AIDifficulty
): Move | null {
  if (!scored.length) return null;

  // Temperature: lower = more deterministic, higher = more random
  // Scale so higher difficulty is tighter
  const temps: Record<AIDifficulty, number> = {
    1: 200, 2: 120, 3: 60, 4: 30, 5: 15, 6: 8,
  };
  const temp = temps[difficulty];

  // Shift scores so the max is 0 (prevents overflow in exp)
  const maxScore = Math.max(...scored.map((s) => s.score));
  const weights = scored.map((s) => Math.exp((s.score - maxScore) / temp));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let r = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].move;
  }
  return scored[scored.length - 1].move;
}

function drawScore(game: Game, state: GameState, aiPlayer: 0 | 1): number {
  // Evaluate whether a draw is good or bad for the AI
  const opp = (1 - aiPlayer) as 0 | 1;
  const my = Object.values(state.pieces).filter((p) => p.player === aiPlayer).length;
  const their = Object.values(state.pieces).filter((p) => p.player === opp).length;
  const pp = game.board.config.piecesPerPlayer;
  const myTotal = pp + (state.totalDeployed?.[aiPlayer] ?? 0);
  const theirTotal = pp + (state.totalDeployed?.[opp] ?? 0);
  const myKills = theirTotal - their;
  const theirKills = myTotal - my;
  // If AI is ahead on kills or pieces, draw is bad — avoid it
  if (myKills > theirKills || my > their) return -800;
  // If behind, draw is an escape
  if (theirKills > myKills || their > my) return 200;
  // Even — slight penalty to encourage decisive play
  return -200;
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
  if (w === "draw") return drawScore(game, state, aiPlayer);

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

  const pp = game.board.config.piecesPerPlayer;
  const myTotal = pp + (state.totalDeployed?.[aiPlayer] ?? 0);
  const oppTotal = pp + (state.totalDeployed?.[opp] ?? 0);
  const myLost = myTotal - myPieces.length;
  const oppLost = oppTotal - oppPieces.length;

  // Both crossed threshold — compare piece counts
  if (myLost >= kt && oppLost >= kt) {
    return (myPieces.length - oppPieces.length) * 200;
  }
  if (oppPieces.length === 0 || oppLost >= kt) return 9999;
  if (myPieces.length === 0 || myLost >= kt) return -9999;

  let score = 0;

  // Material
  score += (myPieces.length - oppPieces.length) * 200;

  // Kill progress bonus — reward getting closer to the kill target
  // urgency: how close we are to winning (1.0 = one kill away, 0.0 = just started)
  const wc = game.board.config.winCondition;
  const myKillsNeeded = kt - oppLost;
  const theirKillsNeeded = kt - myLost;
  const urgency = Math.max(0, 1 - (myKillsNeeded - 1) / Math.max(kt, 1));

  if (wc === "first_to_kills") {
    score += oppLost * 100; // reward kills made
    score -= myLost * 100; // penalize losses taken
    // Bonus for being close to winning (but not when kt=1 and no kills yet)
    if (myKillsNeeded === 1 && oppLost > 0) score += 400;
  } else {
    score += (myPieces.length - oppPieces.length) * 50;
  }

  // Positional evaluation — scale threat weights by urgency
  for (const p of myPieces) {
    score += evalPiecePosition(game, state, p, opp, myPieces, oppPieces, urgency);
  }
  for (const p of oppPieces) {
    // Opponent's urgency for their threats
    const theirUrgency = Math.max(0, 1 - (theirKillsNeeded - 1) / Math.max(kt, 1));
    score -= evalPiecePosition(game, state, p, aiPlayer, oppPieces, myPieces, theirUrgency);
  }

  // Reserve pieces bonus — having reinforcements available is valuable
  if (game.board.config.deployEnabled) {
    const myReserve = state.reservePieces?.[aiPlayer] ?? 0;
    const oppReserve = state.reservePieces?.[opp] ?? 0;
    // Small bonus for having reserves (potential future pieces)
    score += myReserve * 30;
    score -= oppReserve * 30;
    // Encourage deploying when low on pieces (fewer than 3 on board)
    if (myPieces.length < 3 && myReserve > 0) score -= 50; // penalty for not deploying
  }

  return score;
}

function evalPiecePosition(
  game: Game,
  state: GameState,
  piece: Piece,
  enemyPlayer: 0 | 1,
  _allies: Piece[],
  enemies: Piece[],
  urgency: number
): number {
  let score = 0;

  // Offensive multiplier: scales up when close to winning
  // urgency=0 → 1x, urgency=1 → 3x (one kill from victory = very aggressive)
  const offMult = 1 + urgency * 2;

  // Jump threats — can we jump-capture an enemy?
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
      score += 40 * offMult;
    }
  }

  // Push threats — can we push an enemy off the board or into killbox?
  if (game.board.config.pushEnabled) {
    for (const [dq, dr] of DIRS) {
      const nq = piece.q + dq;
      const nr = piece.r + dr;
      const pq = nq + dq;
      const pr = nr + dr;
      const target = Object.values(state.pieces).find(
        (p) => p.q === nq && p.r === nr && p.player === enemyPlayer
      );
      if (!target) continue;
      if (game.board.config.fortressBlocksPush && game.board.isFortress(nq, nr)) continue;
      const offBoard = !game.board.onBoard(pq, pr);
      const intoKillbox = !offBoard && game.board.isKillbox(pq, pr);
      if (offBoard && game.board.config.pushOffBoard) score += 60 * offMult;
      else if (intoKillbox && game.board.config.pushIntoKillbox) score += 50 * offMult;
    }
  }

  // Distance to enemies — closer is better when urgent
  let minD = 99;
  for (const op of enemies) {
    minD = Math.min(minD, hexDist(piece, op));
  }
  if (minD === 2) score += 15 * offMult;
  else if (minD === 1) score += 8 * offMult;
  else score -= minD * (3 + urgency * 5);

  // Edge penalty — more dangerous when opponent is aggressive
  if (hexDist(piece, { q: 0, r: 0 }) === game.board.config.boardRadius) {
    score -= 8;
  }

  // Fortress bonus
  if (game.board.isFortress(piece.q, piece.r)) score += 3;

  // Jump vulnerability — enemy can jump-capture this piece
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

  // Push vulnerability — enemy can push this piece off the board or into killbox
  const cfg = game.board.config;
  if (cfg.pushEnabled) {
    for (const [dq, dr] of DIRS) {
      // Enemy at (piece.q - dq, piece.r - dr) could push this piece to (piece.q + dq, piece.r + dr)
      const eq = piece.q - dq;
      const er = piece.r - dr;
      const pushTo_q = piece.q + dq;
      const pushTo_r = piece.r + dr;

      // Is there an enemy adjacent who could push us?
      const attacker = Object.values(state.pieces).find(
        (p) => p.q === eq && p.r === er && p.player === enemyPlayer
      );
      if (!attacker) continue;

      // Can't be pushed from fortress
      if (cfg.fortressBlocksPush && game.board.isFortress(piece.q, piece.r)) continue;

      const offBoard = !game.board.onBoard(pushTo_q, pushTo_r);
      const intoKillbox = !offBoard && game.board.isKillbox(pushTo_q, pushTo_r);

      if (offBoard && cfg.pushOffBoard) {
        score -= 120; // very dangerous — instant death
      } else if (intoKillbox && cfg.pushIntoKillbox) {
        score -= 100; // pushed into killbox — death
      }
    }
  }

  return score;
}

function moveOrderScore(m: Move): number {
  let score = 0;
  if (m.type === "CHAIN_JUMP") score = (m.enemyKills || 0) * 3 + (m.sacrifice ? -1 : 0);
  else if (m.type === "JUMP" && m.isCapture) score = 2 + (m.sacrifice ? -1 : 0);
  else if (m.type === "PUSH") score = 2;
  else if (m.type === "DEPLOY") score = 1;
  // Bonus for follow-up push (jump + push combo)
  if (m.followUpPush) score += 2;
  return score;
}

function orderMoves(moves: Move[]): void {
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
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
  state.reservePieces = [...snap.reservePieces] as [number, number];
  state.totalDeployed = [...snap.totalDeployed] as [number, number];
}
