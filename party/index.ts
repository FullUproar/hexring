// PartyKit server — manages HexRing game rooms
import type * as Party from "partykit/server";
import { Game } from "../src/lib/engine/game";
import type { Move, GameState, Winner } from "../src/lib/engine/types";
import { DEFAULT_CONFIG } from "../src/lib/engine/types";

// Messages from client → server
type ClientMessage =
  | { type: "join"; playerName: string }
  | { type: "move"; move: Move }
  | { type: "rematch" }
  | { type: "spectate" };

// Messages from server → client
type ServerMessage =
  | { type: "assigned"; player: 0 | 1; playerName: string; opponentName: string }
  | { type: "waiting"; roomId: string }
  | { type: "start"; state: GameState; players: [string, string] }
  | { type: "update"; state: GameState; lastMove: Move; mover: string }
  | { type: "gameover"; state: GameState; winner: Winner; reason: string }
  | { type: "opponent_disconnected" }
  | { type: "opponent_reconnected" }
  | { type: "error"; message: string }
  | { type: "spectate_state"; state: GameState; players: [string, string] };

interface RoomState {
  game: Game;
  players: Map<string, { connId: string; player: 0 | 1; name: string }>;
  playerNames: [string, string];
  started: boolean;
}

export default class HexRingRoom implements Party.Server {
  room: RoomState | null = null;

  constructor(readonly party: Party.Party) {}

  onConnect(conn: Party.Connection) {
    // Send current state if game is in progress (reconnection / spectator)
    if (this.room?.started) {
      conn.send(
        JSON.stringify({
          type: "spectate_state",
          state: this.room.game.state,
          players: this.room.playerNames,
        } satisfies ServerMessage)
      );
    }
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    if (msg.type === "join") {
      this.handleJoin(sender, msg.playerName);
    } else if (msg.type === "move") {
      this.handleMove(sender, msg.move);
    } else if (msg.type === "rematch") {
      this.handleRematch(sender);
    } else if (msg.type === "spectate") {
      if (this.room?.started) {
        sender.send(
          JSON.stringify({
            type: "spectate_state",
            state: this.room.game.state,
            players: this.room.playerNames,
          } satisfies ServerMessage)
        );
      }
    }
  }

  onClose(conn: Party.Connection) {
    if (!this.room) return;

    const playerEntry = this.room.players.get(conn.id);
    if (playerEntry && this.room.started) {
      // Notify opponent
      this.broadcast(
        JSON.stringify({
          type: "opponent_disconnected",
        } satisfies ServerMessage),
        [conn.id]
      );
    }
  }

  private handleJoin(conn: Party.Connection, playerName: string) {
    if (!this.room) {
      // First player — create room
      const game = new Game(DEFAULT_CONFIG);
      this.room = {
        game,
        players: new Map(),
        playerNames: [playerName, ""],
        started: false,
      };
      this.room.players.set(conn.id, {
        connId: conn.id,
        player: 0,
        name: playerName,
      });

      conn.send(
        JSON.stringify({
          type: "waiting",
          roomId: this.party.id,
        } satisfies ServerMessage)
      );
    } else if (this.room.players.size < 2 && !this.room.started) {
      // Second player — start game
      this.room.players.set(conn.id, {
        connId: conn.id,
        player: 1,
        name: playerName,
      });
      this.room.playerNames[1] = playerName;
      this.room.started = true;

      // Tell each player their assignment
      for (const [id, entry] of this.room.players) {
        const oppEntry = [...this.room.players.values()].find(
          (e) => e.connId !== id
        );
        const c = this.party.getConnection(id);
        if (c) {
          c.send(
            JSON.stringify({
              type: "assigned",
              player: entry.player,
              playerName: entry.name,
              opponentName: oppEntry?.name ?? "Opponent",
            } satisfies ServerMessage)
          );
        }
      }

      // Broadcast game start
      this.broadcast(
        JSON.stringify({
          type: "start",
          state: this.room.game.state,
          players: this.room.playerNames,
        } satisfies ServerMessage)
      );
    } else {
      // Room full — spectate
      conn.send(
        JSON.stringify({
          type: "spectate_state",
          state: this.room.game.state,
          players: this.room.playerNames,
        } satisfies ServerMessage)
      );
    }
  }

  private handleMove(conn: Party.Connection, move: Move) {
    if (!this.room?.started) return;

    const playerEntry = this.room.players.get(conn.id);
    if (!playerEntry) return;

    const game = this.room.game;

    // Validate it's this player's turn
    if (game.state.currentPlayer !== playerEntry.player) {
      conn.send(
        JSON.stringify({
          type: "error",
          message: "Not your turn",
        } satisfies ServerMessage)
      );
      return;
    }

    // Validate the move is legal
    const legalMoves = game.allMoves(game.state);
    const isLegal = legalMoves.some(
      (m) =>
        m.type === move.type &&
        m.pieceId === move.pieceId &&
        m.destQ === move.destQ &&
        m.destR === move.destR
    );

    if (!isLegal) {
      conn.send(
        JSON.stringify({
          type: "error",
          message: "Illegal move",
        } satisfies ServerMessage)
      );
      return;
    }

    // Find the matching legal move (use server's version for complete data)
    const serverMove = legalMoves.find(
      (m) =>
        m.type === move.type &&
        m.pieceId === move.pieceId &&
        m.destQ === move.destQ &&
        m.destR === move.destR
    )!;

    // Execute
    const result = game.executeTurn(serverMove);

    if (result.winner !== null) {
      this.broadcast(
        JSON.stringify({
          type: "gameover",
          state: game.state,
          winner: result.winner,
          reason: result.winReason ?? "",
        } satisfies ServerMessage)
      );
    } else {
      this.broadcast(
        JSON.stringify({
          type: "update",
          state: game.state,
          lastMove: serverMove,
          mover: playerEntry.name,
        } satisfies ServerMessage)
      );
    }
  }

  private handleRematch(conn: Party.Connection) {
    if (!this.room) return;

    // Reset game, swap colors
    this.room.game.reset();

    // Swap player assignments
    for (const [, entry] of this.room.players) {
      entry.player = (1 - entry.player) as 0 | 1;
    }
    this.room.playerNames = [
      this.room.playerNames[1],
      this.room.playerNames[0],
    ];

    // Broadcast new game
    for (const [id, entry] of this.room.players) {
      const oppEntry = [...this.room.players.values()].find(
        (e) => e.connId !== id
      );
      const c = this.party.getConnection(id);
      if (c) {
        c.send(
          JSON.stringify({
            type: "assigned",
            player: entry.player,
            playerName: entry.name,
            opponentName: oppEntry?.name ?? "Opponent",
          } satisfies ServerMessage)
        );
      }
    }

    this.broadcast(
      JSON.stringify({
        type: "start",
        state: this.room.game.state,
        players: this.room.playerNames,
      } satisfies ServerMessage)
    );
  }

  private broadcast(message: string, exclude?: string[]) {
    for (const conn of this.party.getConnections()) {
      if (!exclude || !exclude.includes(conn.id)) {
        conn.send(message);
      }
    }
  }
}
