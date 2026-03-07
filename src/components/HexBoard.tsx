"use client";

import { useMemo, useCallback } from "react";
import {
  hexToPixel,
  pixelToHex,
  hexDisk,
  hexRing,
  hexKey,
  parseKey,
} from "@/lib/engine";
import type { Piece, Move } from "@/lib/engine";

const HEX_SIZE = 30;
const BOARD_RADIUS = 4;
const WIDTH = 580;
const HEIGHT = 530;

const boardCells = hexDisk(BOARD_RADIUS);
const killboxCells = hexDisk(1);
const fortressCells = new Set(
  hexRing(2).map((h) => hexKey(h.q, h.r))
);

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
  }
  return pts.join(" ");
}

interface HexBoardProps {
  pieces: Record<number, Piece>;
  validMoves: Move[];
  selectedPieceId: number | null;
  currentPlayer: 0 | 1;
  isInteractive: boolean;
  onHexClick: (q: number, r: number) => void;
}

export default function HexBoard({
  pieces,
  validMoves,
  selectedPieceId,
  onHexClick,
}: HexBoardProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * WIDTH - WIDTH / 2;
      const svgY =
        ((e.clientY - rect.top) / rect.height) * HEIGHT - HEIGHT / 2;
      const hex = pixelToHex(svgX, svgY, HEX_SIZE);
      onHexClick(hex.q, hex.r);
    },
    [onHexClick]
  );

  const cells = useMemo(() => {
    const result: { q: number; r: number; fill: string; stroke: string }[] = [];
    for (const ck of boardCells) {
      const { q, r } = parseKey(ck);
      const isKillbox = killboxCells.has(ck);
      const isFortress = fortressCells.has(ck);
      result.push({
        q,
        r,
        fill: isKillbox ? "#0d0d1a" : isFortress ? "#5c4d3a" : "#2a2a3e",
        stroke: isKillbox ? "#333" : isFortress ? "#8B7355" : "#444",
      });
    }
    return result;
  }, []);

  const killboxList = useMemo(() => {
    const result: { q: number; r: number }[] = [];
    for (const ck of killboxCells) {
      result.push(parseKey(ck));
    }
    return result;
  }, []);

  const fortressList = useMemo(() => hexRing(2), []);

  return (
    <svg
      viewBox={`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-[580px] cursor-pointer touch-none"
      onClick={handleClick}
    >
      {/* Board hexes */}
      {cells.map(({ q, r, fill, stroke }) => {
        const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
        return (
          <polygon
            key={`cell-${q},${r}`}
            points={hexPoints(cx, cy, HEX_SIZE - 1)}
            fill={fill}
            stroke={stroke}
            strokeWidth="1.2"
          />
        );
      })}

      {/* Killbox skulls */}
      {killboxList.map(({ q, r }) => {
        const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
        return (
          <text
            key={`skull-${q},${r}`}
            x={cx}
            y={cy + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="14"
            fill="#444"
          >
            &#x2620;
          </text>
        );
      })}

      {/* Fortress icons */}
      {fortressList.map(({ q, r }) => {
        const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
        return (
          <text
            key={`fort-${q},${r}`}
            x={cx}
            y={cy + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="10"
            fill="#9a8a6a"
          >
            &#x26E8;
          </text>
        );
      })}

      {/* Valid move indicators */}
      {validMoves.map((m, i) => {
        const [cx, cy] = hexToPixel(m.destQ, m.destR, HEX_SIZE);
        let color: string;
        if (m.type === "CHAIN_JUMP") {
          color = (m.enemyKills ?? 0) > 0 ? "#f0f" : "#4f4";
        } else if (m.type === "JUMP" && m.isCapture) {
          color = "#f44";
        } else if (m.type === "JUMP") {
          color = "#4f4";
        } else if (m.type === "PUSH") {
          color = "#f90";
        } else {
          color = "#4f4";
        }

        const labels: Record<string, string> = {
          MOVE: "move",
          PUSH: "push",
          JUMP: m.isCapture ? "capture!" : "jump",
          CHAIN_JUMP:
            (m.enemyKills ?? 0) > 0
              ? `chain(${m.enemyKills}kill)`
              : "chain",
        };

        return (
          <g key={`move-${i}`}>
            <circle
              cx={cx}
              cy={cy}
              r={m.type === "MOVE" ? HEX_SIZE - 8 : HEX_SIZE - 6}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              opacity="0.8"
            />
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              fontSize="8"
              fill={color}
              opacity="0.9"
            >
              {labels[m.type] || m.type}
            </text>

            {/* Chain jump path */}
            {m.type === "CHAIN_JUMP" &&
              m.chainHops &&
              (() => {
                const piece = pieces[m.pieceId];
                if (!piece) return null;
                const lines: React.ReactNode[] = [];
                let pq = piece.q,
                  pr = piece.r;
                for (let j = 0; j < m.chainHops.length; j++) {
                  const hop = m.chainHops[j];
                  const [fx, fy] = hexToPixel(pq, pr, HEX_SIZE);
                  const [tx, ty] = hexToPixel(hop.q, hop.r, HEX_SIZE);
                  lines.push(
                    <line
                      key={`chain-${i}-${j}`}
                      x1={fx}
                      y1={fy}
                      x2={tx}
                      y2={ty}
                      stroke="#f0f"
                      strokeWidth="1.5"
                      strokeDasharray="4,3"
                      opacity="0.4"
                    />
                  );
                  pq = hop.q;
                  pr = hop.r;
                }
                return lines;
              })()}
          </g>
        );
      })}

      {/* Selected piece ring */}
      {selectedPieceId !== null && pieces[selectedPieceId] && (() => {
        const p = pieces[selectedPieceId];
        const [cx, cy] = hexToPixel(p.q, p.r, HEX_SIZE);
        return (
          <circle
            cx={cx}
            cy={cy}
            r={HEX_SIZE - 3}
            fill="none"
            stroke="#ff0"
            strokeWidth="3"
            opacity="0.8"
          />
        );
      })()}

      {/* Pieces */}
      {Object.values(pieces).map((p) => {
        const [cx, cy] = hexToPixel(p.q, p.r, HEX_SIZE);
        const color = p.player === 0 ? "#e74c3c" : "#3498db";
        return (
          <g key={`piece-${p.id}`}>
            <circle
              cx={cx + 1}
              cy={cy + 2}
              r={11}
              fill="rgba(0,0,0,0.4)"
            />
            <circle
              cx={cx}
              cy={cy}
              r={10}
              fill={color}
              stroke="#111"
              strokeWidth="1.5"
            />
          </g>
        );
      })}
    </svg>
  );
}
