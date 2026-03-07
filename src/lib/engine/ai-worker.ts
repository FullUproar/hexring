// Web Worker for AI computation — keeps UI thread responsive

import { Game } from "./game";
import { aiChooseMove } from "./ai";
import type { AIDifficulty } from "./ai";
import type { GameState } from "./types";

export interface AIWorkerRequest {
  type: "compute";
  state: GameState;
  difficulty: AIDifficulty;
}

export interface AIWorkerResponse {
  type: "result";
  move: ReturnType<typeof aiChooseMove>;
  thinkTime: number;
}

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<AIWorkerRequest>) => {
  if (e.data.type === "compute") {
    const start = performance.now();
    const game = new Game();
    // Restore state into the game
    game.state = e.data.state;
    const move = aiChooseMove(game, game.state, e.data.difficulty);
    const thinkTime = performance.now() - start;

    ctx.postMessage({
      type: "result",
      move,
      thinkTime,
    } satisfies AIWorkerResponse);
  }
};
