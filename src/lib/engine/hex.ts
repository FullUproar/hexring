// Hex geometry utilities (axial coordinates)

import type { Hex } from "./types";

export const DIRS: [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseKey(k: string): Hex {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

export function hexDist(a: Hex, b: Hex): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

/** All cells within radius r of the origin. */
export function hexDisk(radius: number): Set<string> {
  const cells = new Set<string>();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) cells.add(hexKey(q, r));
    }
  }
  return cells;
}

/** All cells at exactly radius r from the origin. */
export function hexRing(radius: number): Hex[] {
  if (radius === 0) return [{ q: 0, r: 0 }];
  const res: Hex[] = [];
  let q = -radius,
    r = radius;
  for (const [dq, dr] of DIRS) {
    for (let i = 0; i < radius; i++) {
      res.push({ q, r });
      q += dq;
      r += dr;
    }
  }
  return res;
}

// Pixel conversion (for rendering)
export function hexToPixel(
  q: number,
  r: number,
  size: number
): [number, number] {
  const sqrt3 = Math.sqrt(3);
  return [size * (sqrt3 * q + (sqrt3 / 2) * r), size * ((3 / 2) * r)];
}

export function pixelToHex(
  x: number,
  y: number,
  size: number
): Hex {
  const sqrt3 = Math.sqrt(3);
  const q = ((sqrt3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

export function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q),
    rr = Math.round(r),
    rs = Math.round(s);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}
