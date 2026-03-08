// Core game logic: state management, move generation, move application

import { DIRS, hexKey, parseKey } from "./hex";
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
    const reserve = this.board.config.deployEnabled ? this.board.config.reservePieces : 0;
    const state: GameState = {
      pieces,
      nextPieceId: id,
      currentPlayer: 0,
      winner: null,
      positionHistory: {},
      turnCount: 0,
      reservePieces: [reserve, reserve],
      totalDeployed: [0, 0],
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
    const wc = this.board.config.winCondition;
    const kt = this.board.config.killTarget;

    if (wc === "eliminate_all") {
      if (r === 0 && b === 0) return "draw";
      if (r === 0) return 1;
      if (b === 0) return 0;
      return null;
    }

    if (wc === "last_standing") {
      // Win when opponent has only 1 piece left
      if (r <= 1 && b <= 1) return "draw";
      if (r <= 1) return 1;
      if (b <= 1) return 0;
      return null;
    }

    // first_to_kills (default)
    // Total pieces a player has ever had = starting + deployed from reserve
    const redTotal = pp + (state.totalDeployed?.[0] ?? 0);
    const blueTotal = pp + (state.totalDeployed?.[1] ?? 0);
    const redLost = redTotal - r;
    const blueLost = blueTotal - b;

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
      const pp = this.board.config.piecesPerPlayer;
      const redKills = (pp + (state.totalDeployed?.[1] ?? 0)) - b;
      const blueKills = (pp + (state.totalDeployed?.[0] ?? 0)) - r;
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
    const cfg = this.board.config;

    for (const [dq, dr] of DIRS) {
      const nq = piece.q + dq;
      const nr = piece.r + dr;
      if (!this.board.onBoard(nq, nr)) continue;

      const occ = this.piecesAt(state, nq, nr);

      // MOVE — step to empty, non-killbox hex
      if (!occ.length && !this.board.isKillbox(nq, nr)) {
        moves.push({ type: "MOVE", destQ: nq, destR: nr, pieceId: piece.id });
      }

      // PUSH — shove adjacent enemy (simple push always available; chain push as extra option)
      if (cfg.pushEnabled && occ.length && occ[0].player !== pid) {
        const target = occ[0];
        const blocked = cfg.fortressBlocksPush && this.board.isFortress(nq, nr);
        if (!blocked) {
          // Simple push — always available as an option
          const pq = nq + dq;
          const pr = nr + dr;
          const offBoard = !this.board.onBoard(pq, pr);
          const intoKillbox = !offBoard && this.board.isKillbox(pq, pr);
          const pushable =
            (offBoard && cfg.pushOffBoard) ||
            (intoKillbox && cfg.pushIntoKillbox) ||
            (!offBoard && !intoKillbox && !this.occupied(state, pq, pr));
          if (pushable) {
            moves.push({
              type: "PUSH",
              destQ: nq,
              destR: nr,
              pieceId: piece.id,
              targetId: target.id,
              pushDest: [pq, pr],
            });
          }

          // Chain push — additional option when there's a line of 2+ pieces
          if (cfg.chainPush) {
            const chainIds: number[] = [];
            let cq = nq, cr = nr;
            let chainBlocked = false;
            while (true) {
              const cp = this.piecesAt(state, cq, cr);
              if (!cp.length) break;
              if (cfg.fortressBlocksPush && this.board.isFortress(cq, cr) && chainIds.length > 0) {
                chainBlocked = true; break;
              }
              chainIds.push(cp[0].id);
              cq += dq;
              cr += dr;
              if (!this.board.onBoard(cq, cr)) break;
            }
            // Only generate chain push if there are 2+ pieces in the line
            // (single piece is already covered by simple push above)
            if (!chainBlocked && chainIds.length >= 2) {
              const cOffBoard = !this.board.onBoard(cq, cr);
              const cIntoKillbox = !cOffBoard && this.board.isKillbox(cq, cr);
              const cPushable =
                (cOffBoard && cfg.pushOffBoard) ||
                (cIntoKillbox && cfg.pushIntoKillbox) ||
                (!cOffBoard && !cIntoKillbox && !this.occupied(state, cq, cr));
              if (cPushable) {
                moves.push({
                  type: "PUSH",
                  destQ: nq,
                  destR: nr,
                  pieceId: piece.id,
                  targetId: target.id,
                  pushDest: [nq + dq, nr + dr],
                  chainPushIds: chainIds,
                });
              }
            }
          }
        }
      }

      // JUMP — leap over adjacent piece
      if (occ.length) {
        const isEnemy = occ[0].player !== pid;
        const canJumpThis =
          (isEnemy && cfg.jumpOverEnemy) || (!isEnemy && cfg.jumpOverFriendly);
        if (canJumpThis) {
          const lq = nq + dq;
          const lr = nr + dr;
          const landable = this.board.onBoard(lq, lr) && !this.occupied(state, lq, lr);
          const fortressBlocked = cfg.fortressBlocksJump && this.board.isFortress(nq, nr);
          if (landable && !fortressBlocked) {
            const isSacrifice = this.board.isKillbox(lq, lr);
            if (!isSacrifice || cfg.sacrificeJumps) {
              const capture = isEnemy && cfg.captureOnJump;
              moves.push({
                type: "JUMP",
                destQ: lq,
                destR: lr,
                pieceId: piece.id,
                targetId: occ[0].id,
                isCapture: capture,
                jumpOver: [nq, nr],
                sacrifice: isSacrifice,
              });
            }
          }
        }
      }
    }

    // CHAIN JUMP (DFS)
    if (cfg.chainJumps) {
      const maxLen = cfg.maxChainLength;
      const chainResults: ChainHop[][] = [];
      const chainDFS = (
        q: number,
        r: number,
        visited: Set<number>,
        hops: ChainHop[]
      ) => {
        // Record current position as a valid chain stop
        if (hops.length >= 2) {
          chainResults.push(hops);
        }
        for (const [dq, dr] of DIRS) {
          const nq = q + dq;
          const nr = r + dr;
          const lq = nq + dq;
          const lr = nr + dr;
          if (!this.board.onBoard(nq, nr) || !this.board.onBoard(lq, lr))
            continue;
          const occ = this.piecesAt(state, nq, nr);
          if (!occ.length) continue;
          const isEnemy = occ[0].player !== pid;
          const canJumpThis =
            (isEnemy && cfg.jumpOverEnemy) || (!isEnemy && cfg.jumpOverFriendly);
          if (!canJumpThis) continue;
          if (cfg.fortressBlocksJump && this.board.isFortress(nq, nr)) continue;
          const jid = occ[0].id;
          if (visited.has(jid)) continue;
          if (
            this.occupied(state, lq, lr) &&
            !(lq === piece.q && lr === piece.r)
          )
            continue;
          if (hops.length >= maxLen) continue;

          const nv = new Set(visited);
          nv.add(jid);
          const newHops: ChainHop[] = [
            ...hops,
            { q: lq, r: lr, targetId: jid, isEnemy },
          ];

          if (this.board.isKillbox(lq, lr)) {
            // Sacrifice — ends chain
            if (cfg.sacrificeJumps && newHops.length >= 2)
              chainResults.push(newHops);
          } else {
            chainDFS(lq, lr, nv, newHops);
          }
        }
      };

      chainDFS(piece.q, piece.r, new Set(), []);

      for (const chain of chainResults) {
        const last = chain[chain.length - 1];
        const enemyKills = cfg.captureOnJump
          ? chain.filter((h) => h.isEnemy).length
          : 0;
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
    }

    // Push after jump — generate variants with a follow-up push
    if (cfg.pushAfterJump && cfg.pushEnabled) {
      const jumpMoves = moves.filter(
        (m) => (m.type === "JUMP" || m.type === "CHAIN_JUMP") && !m.sacrifice
      );
      for (const jm of jumpMoves) {
        const pushVariants = this.genFollowUpPushes(state, jm, piece);
        moves.push(...pushVariants);
      }
    }

    return moves;
  }

  private genFollowUpPushes(state: GameState, jumpMove: Move, piece: Piece): Move[] {
    const results: Move[] = [];
    const cfg = this.board.config;
    const landQ = jumpMove.destQ;
    const landR = jumpMove.destR;

    // Simulate the jump to see what pieces are left
    // (captures remove enemies, chain jumps remove multiple)
    const removedIds = new Set<number>();
    if (jumpMove.type === "JUMP" && jumpMove.isCapture) {
      removedIds.add(jumpMove.targetId!);
    } else if (jumpMove.type === "CHAIN_JUMP" && jumpMove.chainTargets) {
      for (const tid of jumpMove.chainTargets) {
        const t = state.pieces[tid];
        if (t && t.player !== piece.player) removedIds.add(tid);
      }
    }

    for (const [dq, dr] of DIRS) {
      const nq = landQ + dq;
      const nr = landR + dr;
      if (!this.board.onBoard(nq, nr)) continue;

      // Find enemy at adjacent position (not removed by the jump)
      const target = Object.values(state.pieces).find(
        (p) => p.q === nq && p.r === nr && p.player !== piece.player && !removedIds.has(p.id)
      );
      if (!target) continue;
      if (cfg.fortressBlocksPush && this.board.isFortress(nq, nr)) continue;

      if (cfg.chainPush) {
        // Chain push from the follow-up
        const chainIds: number[] = [];
        let cq = nq, cr = nr;
        let blocked = false;
        while (true) {
          // Skip the jumping piece's original position (it will have moved)
          const cp = Object.values(state.pieces).find(
            (p) => p.q === cq && p.r === cr && !removedIds.has(p.id) && p.id !== piece.id
          );
          if (!cp) break;
          if (cfg.fortressBlocksPush && this.board.isFortress(cq, cr) && chainIds.length > 0) {
            blocked = true; break;
          }
          chainIds.push(cp.id);
          cq += dq;
          cr += dr;
          if (!this.board.onBoard(cq, cr)) break;
        }
        if (blocked || !chainIds.length) continue;
        const offBoard = !this.board.onBoard(cq, cr);
        const intoKillbox = !offBoard && this.board.isKillbox(cq, cr);
        // Check the end position isn't occupied (excluding removed/moved pieces)
        const endOccupied = !offBoard && !intoKillbox && Object.values(state.pieces).some(
          (p) => p.q === cq && p.r === cr && !removedIds.has(p.id) && p.id !== piece.id
        );
        const pushable =
          (offBoard && cfg.pushOffBoard) ||
          (intoKillbox && cfg.pushIntoKillbox) ||
          (!offBoard && !intoKillbox && !endOccupied);
        if (pushable) {
          results.push({
            ...jumpMove,
            followUpPush: {
              targetId: target.id,
              pushDest: [nq + dq, nr + dr],
              chainPushIds: chainIds,
            },
          });
        }
      } else {
        // Simple push
        const pq = nq + dq;
        const pr = nr + dr;
        const offBoard = !this.board.onBoard(pq, pr);
        const intoKillbox = !offBoard && this.board.isKillbox(pq, pr);
        // Check destination isn't occupied (excluding pieces removed by jump and the jumping piece itself)
        const destOccupied = !offBoard && !intoKillbox && Object.values(state.pieces).some(
          (p) => p.q === pq && p.r === pr && !removedIds.has(p.id) && p.id !== piece.id
        );
        const pushable =
          (offBoard && cfg.pushOffBoard) ||
          (intoKillbox && cfg.pushIntoKillbox) ||
          (!offBoard && !intoKillbox && !destOccupied);
        if (pushable) {
          results.push({
            ...jumpMove,
            followUpPush: {
              targetId: target.id,
              pushDest: [pq, pr],
            },
          });
        }
      }
    }
    return results;
  }

  allMoves(state: GameState, player?: 0 | 1): Move[] {
    const p = player ?? state.currentPlayer;
    const moves: Move[] = [];
    for (const piece of Object.values(state.pieces)) {
      if (piece.player === p) moves.push(...this.genMoves(state, piece));
    }
    // DEPLOY moves — place a reserve piece on an empty hex in player's deploy zone
    if (this.board.config.deployEnabled && state.reservePieces[p] > 0) {
      for (const key of this.board.deployZone[p]) {
        const { q, r } = parseKey(key);
        if (!this.occupied(state, q, r) && !this.board.isKillbox(q, r)) {
          moves.push({
            type: "DEPLOY",
            pieceId: -1, // no existing piece
            destQ: q,
            destR: r,
          });
        }
      }
    }
    return moves;
  }

  // --- Apply move (mutates state) ---

  applyMove(state: GameState, move: Move): void {
    // DEPLOY doesn't use an existing piece
    if (move.type === "DEPLOY") {
      const player = state.currentPlayer;
      const id = state.nextPieceId++;
      state.pieces[id] = {
        id,
        player,
        q: move.destQ,
        r: move.destR,
      };
      state.reservePieces[player]--;
      state.totalDeployed[player]++;
      return;
    }

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
      this.applyPush(state, move.targetId!, move.pushDest!, move.chainPushIds);
    } else if (move.type === "JUMP") {
      piece.q = move.destQ;
      piece.r = move.destR;
      if (move.isCapture) delete state.pieces[move.targetId!];
      if (this.board.isKillbox(piece.q, piece.r)) {
        delete state.pieces[piece.id];
      }
      if (move.followUpPush && state.pieces[piece.id]) {
        const fup = move.followUpPush;
        const target = state.pieces[fup.targetId];
        if (target) {
          // Pusher moves into the target's hex
          const tq = target.q, tr = target.r;
          this.applyPush(state, fup.targetId, fup.pushDest, fup.chainPushIds);
          piece.q = tq;
          piece.r = tr;
        }
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
      if (move.followUpPush && state.pieces[piece.id]) {
        const fup = move.followUpPush;
        const target = state.pieces[fup.targetId];
        if (target) {
          // Pusher moves into the target's hex
          const tq = target.q, tr = target.r;
          this.applyPush(state, fup.targetId, fup.pushDest, fup.chainPushIds);
          piece.q = tq;
          piece.r = tr;
        }
      }
    }
  }

  private applyPush(
    state: GameState,
    targetId: number,
    pushDest: [number, number],
    chainPushIds?: number[]
  ): void {
    if (chainPushIds && chainPushIds.length > 1) {
      // Chain push: shift all pieces in the chain, from farthest to closest
      // Derive direction from first target and its push dest
      const first = state.pieces[chainPushIds[0]];
      if (!first) return;
      const dq = pushDest[0] - first.q;
      const dr = pushDest[1] - first.r;

      // Process from the end of the chain backward
      for (let i = chainPushIds.length - 1; i >= 0; i--) {
        const p = state.pieces[chainPushIds[i]];
        if (!p) continue;
        const newQ = p.q + dq;
        const newR = p.r + dr;
        if (!this.board.onBoard(newQ, newR)) {
          delete state.pieces[p.id];
        } else if (this.board.isKillbox(newQ, newR)) {
          delete state.pieces[p.id];
        } else {
          p.q = newQ;
          p.r = newR;
        }
      }
    } else {
      // Simple push
      const target = state.pieces[targetId];
      if (target) {
        const [pq, pr] = pushDest;
        if (!this.board.onBoard(pq, pr) || this.board.isKillbox(pq, pr)) {
          delete state.pieces[target.id];
        } else {
          target.q = pq;
          target.r = pr;
        }
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

    // Check turn limit
    const tl = this.board.config.turnLimit;
    if (tl > 0 && this.state.turnCount >= tl) {
      const r = this.pieceCount(this.state, 0);
      const b = this.pieceCount(this.state, 1);
      const tw: Winner = r > b ? 0 : b > r ? 1 : "draw";
      this.state.winner = tw;
      this.state.winReason = `Turn limit (${tl}) — ${tw === 0 ? "Red wins!" : tw === 1 ? "Blue wins!" : "Draw!"}`;
      return { winner: tw, winReason: this.state.winReason };
    }

    // Check threefold repetition
    if (this.board.config.threefoldRepetition) {
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
    }

    // Check if next player has moves; if not, skip
    const nextMoves = this.allMoves(this.state);
    if (!nextMoves.length) {
      this.state.currentPlayer = (1 - this.state.currentPlayer) as 0 | 1;
      if (this.board.config.threefoldRepetition) {
        const rep2 = this.checkThreefoldRepetition(this.state);
        if (rep2 !== null) {
          this.state.winner = rep2;
          this.state.winReason = "Threefold repetition!";
          return { winner: rep2, winReason: this.state.winReason };
        }
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
      reservePieces: [...state.reservePieces] as [number, number],
      totalDeployed: [...state.totalDeployed] as [number, number],
    };
  }
}
