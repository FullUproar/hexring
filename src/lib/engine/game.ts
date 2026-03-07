// Core game logic: state management, move generation, move application

import { DIRS, hexKey } from "./hex";
import { Board } from "./board";
import type {
  GameState,
  GameConfig,
  Piece,
  Move,
  ChainHop,
  Winner,
} from "./types";
import { DEFAULT_CONFIG } from "./types";

export class Game {
  readonly board: Board;
  state: GameState;

  constructor(config: GameConfig = DEFAULT_CONFIG) {
    this.board = new Board(config);
    this.state = this.createInitialState();
  }

  private createInitialState(): GameState {
    const pieces: Record<number, Piece> = {};
    let id = 0;
    for (let player = 0; player < 2; player++) {
      for (const pos of this.board.startPositions[player]) {
        pieces[id] = { id, player: player as 0 | 1, q: pos.q, r: pos.r };
        id++;
      }
    }
    const state: GameState = {
      pieces,
      nextPieceId: id,
      currentPlayer: 0,
      winner: null,
      positionHistory: {},
      turnCount: 0,
    };
    // Record initial position
    this.recordPosition(state);
    return state;
  }

  reset(): void {
    this.state = this.createInitialState();
  }

  // --- Helpers ---

  private piecesAt(
    state: GameState,
    q: number,
    r: number
  ): Piece[] {
    return Object.values(state.pieces).filter(
      (p) => p.q === q && p.r === r
    );
  }

  private occupied(state: GameState, q: number, r: number): boolean {
    return this.piecesAt(state, q, r).length > 0;
  }

  private pieceCount(state: GameState, player: 0 | 1): number {
    return Object.values(state.pieces).filter((p) => p.player === player)
      .length;
  }

  // --- Position history (threefold repetition) ---

  private boardHash(state: GameState): string {
    const pcs = Object.values(state.pieces)
      .map((p) => `${p.player},${p.q},${p.r}`)
      .sort();
    return pcs.join("|") + ":" + state.currentPlayer;
  }

  private recordPosition(state: GameState): number {
    const h = this.boardHash(state);
    state.positionHistory[h] = (state.positionHistory[h] || 0) + 1;
    return state.positionHistory[h];
  }

  // --- Win condition ---

  checkWinner(state: GameState): Winner {
    const r = this.pieceCount(state, 0);
    const b = this.pieceCount(state, 1);
    const pp = this.board.config.piecesPerPlayer;
    const kt = this.board.config.killTarget;

    const redLost = pp - r;
    const blueLost = pp - b;

    // Both eliminated enough — compare who has more
    if (redLost >= kt && blueLost >= kt) {
      if (r > b) return 0;
      if (b > r) return 1;
      return "draw";
    }
    // One side lost enough pieces
    if (r === 0 || redLost >= kt) return 1;
    if (b === 0 || blueLost >= kt) return 0;
    return null;
  }

  private checkThreefoldRepetition(state: GameState): Winner {
    const repeats = this.recordPosition(state);
    if (repeats >= 3) {
      const r = this.pieceCount(state, 0);
      const b = this.pieceCount(state, 1);
      const redKills = this.board.config.piecesPerPlayer - b;
      const blueKills = this.board.config.piecesPerPlayer - r;
      if (redKills > blueKills) return 0;
      if (blueKills > redKills) return 1;
      if (r > b) return 0;
      if (b > r) return 1;
      return "draw";
    }
    return null;
  }

  // --- Move generation ---

  genMoves(state: GameState, piece: Piece): Move[] {
    const moves: Move[] = [];
    const pid = piece.player;

    for (const [dq, dr] of DIRS) {
      const nq = piece.q + dq;
      const nr = piece.r + dr;
      if (!this.board.onBoard(nq, nr)) continue;

      const occ = this.piecesAt(state, nq, nr);

      // MOVE — step to empty, non-killbox hex
      if (!occ.length && !this.board.isKillbox(nq, nr)) {
        moves.push({ type: "MOVE", destQ: nq, destR: nr, pieceId: piece.id });
      }

      // PUSH — shove adjacent enemy
      if (occ.length && occ[0].player !== pid) {
        const target = occ[0];
        if (!this.board.isFortress(nq, nr)) {
          const pq = nq + dq;
          const pr = nr + dr;
          if (
            !this.board.onBoard(pq, pr) ||
            this.board.isKillbox(pq, pr) ||
            !this.occupied(state, pq, pr)
          ) {
            moves.push({
              type: "PUSH",
              destQ: nq,
              destR: nr,
              pieceId: piece.id,
              targetId: target.id,
              pushDest: [pq, pr],
            });
          }
        }
      }

      // JUMP — leap over adjacent piece
      if (occ.length) {
        const lq = nq + dq;
        const lr = nr + dr;
        if (this.board.onBoard(lq, lr) && !this.occupied(state, lq, lr)) {
          const isEnemy = occ[0].player !== pid;
          moves.push({
            type: "JUMP",
            destQ: lq,
            destR: lr,
            pieceId: piece.id,
            targetId: occ[0].id,
            isCapture: isEnemy,
            jumpOver: [nq, nr],
            sacrifice: this.board.isKillbox(lq, lr),
          });
        }
      }
    }

    // CHAIN JUMP (DFS)
    const chainResults: ChainHop[][] = [];
    const chainDFS = (
      q: number,
      r: number,
      visited: Set<number>,
      hops: ChainHop[]
    ) => {
      let extended = false;
      for (const [dq, dr] of DIRS) {
        const nq = q + dq;
        const nr = r + dr;
        const lq = nq + dq;
        const lr = nr + dr;
        if (!this.board.onBoard(nq, nr) || !this.board.onBoard(lq, lr))
          continue;
        const occ = this.piecesAt(state, nq, nr);
        if (!occ.length) continue;
        const jid = occ[0].id;
        if (visited.has(jid)) continue;
        if (
          this.occupied(state, lq, lr) &&
          !(lq === piece.q && lr === piece.r)
        )
          continue;
        if (hops.length >= 5) continue;

        extended = true;
        const nv = new Set(visited);
        nv.add(jid);
        const newHops: ChainHop[] = [
          ...hops,
          { q: lq, r: lr, targetId: jid, isEnemy: occ[0].player !== pid },
        ];

        if (this.board.isKillbox(lq, lr)) {
          // Sacrifice — ends chain
          if (newHops.length >= 2) chainResults.push(newHops);
        } else {
          chainDFS(lq, lr, nv, newHops);
        }
      }
      if (!extended && hops.length >= 2) {
        chainResults.push(hops);
      }
    };

    chainDFS(piece.q, piece.r, new Set(), []);

    for (const chain of chainResults) {
      const last = chain[chain.length - 1];
      const enemyKills = chain.filter((h) => h.isEnemy).length;
      moves.push({
        type: "CHAIN_JUMP",
        destQ: last.q,
        destR: last.r,
        pieceId: piece.id,
        chainTargets: chain.map((h) => h.targetId),
        chainHops: chain,
        enemyKills,
        sacrifice: this.board.isKillbox(last.q, last.r),
      });
    }

    return moves;
  }

  allMoves(state: GameState, player?: 0 | 1): Move[] {
    const p = player ?? state.currentPlayer;
    const moves: Move[] = [];
    for (const piece of Object.values(state.pieces)) {
      if (piece.player === p) moves.push(...this.genMoves(state, piece));
    }
    return moves;
  }

  // --- Apply move (mutates state) ---

  applyMove(state: GameState, move: Move): void {
    const piece = state.pieces[move.pieceId];
    if (!piece) return;

    if (move.type === "MOVE") {
      piece.q = move.destQ;
      piece.r = move.destR;
      if (this.board.isKillbox(piece.q, piece.r)) {
        delete state.pieces[piece.id];
      }
    } else if (move.type === "PUSH") {
      piece.q = move.destQ;
      piece.r = move.destR;
      const target = state.pieces[move.targetId!];
      if (target) {
        const [pq, pr] = move.pushDest!;
        if (!this.board.onBoard(pq, pr) || this.board.isKillbox(pq, pr)) {
          delete state.pieces[target.id];
        } else {
          target.q = pq;
          target.r = pr;
          if (this.board.isKillbox(target.q, target.r)) {
            delete state.pieces[target.id];
          }
        }
      }
    } else if (move.type === "JUMP") {
      piece.q = move.destQ;
      piece.r = move.destR;
      if (move.isCapture) delete state.pieces[move.targetId!];
      if (this.board.isKillbox(piece.q, piece.r)) {
        delete state.pieces[piece.id];
      }
    } else if (move.type === "CHAIN_JUMP") {
      piece.q = move.destQ;
      piece.r = move.destR;
      for (const tid of move.chainTargets!) {
        const t = state.pieces[tid];
        if (t && t.player !== piece.player) delete state.pieces[tid];
      }
      if (this.board.isKillbox(piece.q, piece.r)) {
        delete state.pieces[piece.id];
      }
    }
  }

  // --- Execute a full turn (apply + check win + switch player) ---

  executeTurn(move: Move): {
    winner: Winner;
    winReason?: string;
  } {
    this.applyMove(this.state, move);
    this.state.turnCount++;

    // Check for captures/elimination win
    const w = this.checkWinner(this.state);
    if (w !== null) {
      this.state.winner = w;
      this.state.winReason =
        w === 0 ? "Red wins!" : w === 1 ? "Blue wins!" : "Draw!";
      return { winner: w, winReason: this.state.winReason };
    }

    // Switch player
    this.state.currentPlayer = (1 - this.state.currentPlayer) as 0 | 1;

    // Check threefold repetition
    const rep = this.checkThreefoldRepetition(this.state);
    if (rep !== null) {
      this.state.winner = rep;
      const reason =
        rep === 0
          ? "Threefold repetition — Red wins!"
          : rep === 1
            ? "Threefold repetition — Blue wins!"
            : "Threefold repetition — Draw!";
      this.state.winReason = reason;
      return { winner: rep, winReason: reason };
    }

    // Check if next player has moves; if not, skip
    const nextMoves = this.allMoves(this.state);
    if (!nextMoves.length) {
      this.state.currentPlayer = (1 - this.state.currentPlayer) as 0 | 1;
      const rep2 = this.checkThreefoldRepetition(this.state);
      if (rep2 !== null) {
        this.state.winner = rep2;
        this.state.winReason = "Threefold repetition!";
        return { winner: rep2, winReason: this.state.winReason };
      }
    }

    return { winner: null };
  }

  // --- Snapshot / restore for AI ---

  snapshot(state: GameState): GameState {
    return {
      pieces: Object.fromEntries(
        Object.entries(state.pieces).map(([k, p]) => [k, { ...p }])
      ),
      nextPieceId: state.nextPieceId,
      currentPlayer: state.currentPlayer,
      winner: state.winner,
      positionHistory: { ...state.positionHistory },
      turnCount: state.turnCount,
    };
  }
}
