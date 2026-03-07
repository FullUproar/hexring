// Core types for the HexRing game engine

export interface Hex {
  q: number;
  r: number;
}

export interface Piece {
  id: number;
  player: 0 | 1;
  q: number;
  r: number;
}

export type MoveType = "MOVE" | "PUSH" | "JUMP" | "CHAIN_JUMP";

export interface ChainHop {
  q: number;
  r: number;
  targetId: number;
  isEnemy: boolean;
}

export interface Move {
  type: MoveType;
  pieceId: number;
  destQ: number;
  destR: number;
  // PUSH
  targetId?: number;
  pushDest?: [number, number];
  // JUMP
  isCapture?: boolean;
  jumpOver?: [number, number];
  sacrifice?: boolean;
  // CHAIN_JUMP
  chainHops?: ChainHop[];
  chainTargets?: number[];
  enemyKills?: number;
}

export type Winner = 0 | 1 | "draw" | null;

export interface GameState {
  pieces: Record<number, Piece>;
  nextPieceId: number;
  currentPlayer: 0 | 1;
  winner: Winner;
  winReason?: string;
  positionHistory: Record<string, number>;
  turnCount: number;
}

export interface GameConfig {
  boardRadius: number;
  killboxRadius: number;
  fortressRing: number;
  piecesPerPlayer: number;
  killTarget: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  boardRadius: 4,
  killboxRadius: 1,
  fortressRing: 2,
  piecesPerPlayer: 5,
  killTarget: 3,
};
