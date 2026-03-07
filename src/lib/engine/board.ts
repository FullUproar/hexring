// Board configuration — zones and starting positions

import { hexDisk, hexRing, hexKey } from "./hex";
import type { GameConfig, Hex } from "./types";
import { DEFAULT_CONFIG } from "./types";

export class Board {
  readonly config: GameConfig;
  readonly cells: Set<string>;
  readonly killbox: Set<string>;
  readonly fortress: Set<string>;
  readonly startPositions: [Hex[], Hex[]];

  constructor(config: GameConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.cells = hexDisk(config.boardRadius);
    this.killbox = hexDisk(config.killboxRadius);
    this.fortress = new Set(
      hexRing(config.fortressRing).map((h) => hexKey(h.q, h.r))
    );

    // Starting positions: players on opposite sides of outer ring
    const ring = hexRing(config.boardRadius);
    const half = Math.floor(ring.length / 2);
    const p0: Hex[] = [];
    const p1: Hex[] = [];
    for (let i = 0; i < config.piecesPerPlayer; i++) {
      p0.push(ring[(i * 2) % ring.length]);
      p1.push(ring[(half + i * 2) % ring.length]);
    }
    this.startPositions = [p0, p1];
  }

  onBoard(q: number, r: number): boolean {
    return this.cells.has(hexKey(q, r));
  }

  isKillbox(q: number, r: number): boolean {
    return this.killbox.has(hexKey(q, r));
  }

  isFortress(q: number, r: number): boolean {
    return this.fortress.has(hexKey(q, r));
  }
}
