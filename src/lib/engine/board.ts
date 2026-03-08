// Board configuration — zones and starting positions

import { hexDisk, hexRing, hexKey, parseKey } from "./hex";
import type { GameConfig, Hex } from "./types";
import { DEFAULT_CONFIG } from "./types";

export class Board {
  readonly config: GameConfig;
  readonly cells: Set<string>;
  readonly killbox: Set<string>;
  readonly fortress: Set<string>;
  readonly deployZone: [Set<string>, Set<string>]; // per-player deploy zones
  readonly startPositions: [Hex[], Hex[]];

  constructor(config: GameConfig = DEFAULT_CONFIG) {
    if (config.customTiles) {
      // --- Custom board from tile map ---
      const cells = new Set<string>();
      const killbox = new Set<string>();
      const fortress = new Set<string>();
      const d0 = new Set<string>();
      const d1 = new Set<string>();
      const s0: Hex[] = [];
      const s1: Hex[] = [];

      for (const [key, type] of Object.entries(config.customTiles)) {
        cells.add(key);
        if (type === "killbox") killbox.add(key);
        else if (type === "fortress") fortress.add(key);
        else if (type === "deploy0") d0.add(key);
        else if (type === "deploy1") d1.add(key);
        else if (type === "start0") s0.push(parseKey(key));
        else if (type === "start1") s1.push(parseKey(key));
      }

      this.cells = cells;
      this.killbox = killbox;
      this.fortress = fortress;
      this.deployZone = [d0, d1];
      this.startPositions = [s0, s1];
      // Override piecesPerPlayer to match start tiles
      this.config = {
        ...config,
        piecesPerPlayer: Math.max(s0.length, s1.length),
        deployEnabled: d0.size > 0 || d1.size > 0,
      };
      return;
    }

    // --- Radius-based board ---
    this.config = config;
    this.cells = hexDisk(config.boardRadius);
    this.killbox = hexDisk(config.killboxRadius);
    this.fortress = new Set(
      hexRing(config.fortressRing).map((h) => hexKey(h.q, h.r))
    );
    // Starting positions
    const ring = hexRing(config.boardRadius);
    const half = Math.floor(ring.length / 2);
    const p0: Hex[] = [];
    const p1: Hex[] = [];
    const n = config.piecesPerPlayer;

    if (config.startLayout === "spread") {
      for (let i = 0; i < n; i++) {
        p0.push(ring[(i * 2) % ring.length]);
        p1.push(ring[(half + i * 2) % ring.length]);
      }
    } else {
      const groupStart0 = Math.floor(half / 2 - n / 2);
      const groupStart1 = half + Math.floor(half / 2 - n / 2);
      for (let i = 0; i < n; i++) {
        p0.push(ring[(groupStart0 + i) % ring.length]);
        p1.push(ring[(groupStart1 + i) % ring.length]);
      }
    }
    this.startPositions = [p0, p1];

    // Deploy zones
    if (config.deployEnabled) {
      const dRing = hexRing(config.deployZone);
      const dHalf = Math.floor(dRing.length / 2);
      const d0 = new Set<string>();
      const d1 = new Set<string>();
      for (let i = 0; i < dRing.length; i++) {
        const key = hexKey(dRing[i].q, dRing[i].r);
        if (i < dHalf) d0.add(key);
        else d1.add(key);
      }
      this.deployZone = [d0, d1];
    } else {
      this.deployZone = [new Set(), new Set()];
    }
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

  isDeployZone(q: number, r: number, player?: 0 | 1): boolean {
    const key = hexKey(q, r);
    if (player !== undefined) return this.deployZone[player].has(key);
    return this.deployZone[0].has(key) || this.deployZone[1].has(key);
  }
}
