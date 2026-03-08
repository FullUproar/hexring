"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { hexToPixel, pixelToHex, hexDisk, hexKey, parseKey } from "@/lib/engine";
import type { TileType } from "@/lib/engine";

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
  }
  return pts.join(" ");
}

const TILE_COLORS: Record<TileType, { fill: string; stroke: string; label: string; icon?: string }> = {
  normal:   { fill: "#2a2a3e", stroke: "#444", label: "Board" },
  killbox:  { fill: "#0d0d1a", stroke: "#333", label: "Killbox", icon: "\u2620" },
  fortress: { fill: "#5c4d3a", stroke: "#8B7355", label: "Fortress", icon: "\u26E8" },
  deploy0:  { fill: "#2e1a1a", stroke: "#6b2d2d", label: "Deploy Red", icon: "+" },
  deploy1:  { fill: "#1a1a2e", stroke: "#2d2d6b", label: "Deploy Blue", icon: "+" },
  start0:   { fill: "#3d1a1a", stroke: "#e74c3c", label: "Start Red", icon: "\u25CF" },
  start1:   { fill: "#1a1a3d", stroke: "#3498db", label: "Start Blue", icon: "\u25CF" },
};

const TOOLS: (TileType | "eraser")[] = ["normal", "killbox", "fortress", "deploy0", "deploy1", "start0", "start1", "eraser"];

interface BoardEditorProps {
  tiles: Record<string, TileType>;
  onChange: (tiles: Record<string, TileType>) => void;
  editorRadius: number;
}

export default function BoardEditor({ tiles, onChange, editorRadius }: BoardEditorProps) {
  const [tool, setTool] = useState<TileType | "eraser">("normal");
  const painting = useRef(false);

  const HEX_SIZE = editorRadius <= 3 ? 36 : editorRadius <= 5 ? 28 : 20;
  const WIDTH = HEX_SIZE * (editorRadius * 2 + 1) * 2 + 40;
  const HEIGHT = HEX_SIZE * (editorRadius * 2 + 1) * 1.8 + 40;

  const gridKeys = useMemo(() => hexDisk(editorRadius), [editorRadius]);

  const paint = useCallback(
    (q: number, r: number) => {
      const key = hexKey(q, r);
      if (!gridKeys.has(key)) return;
      const next = { ...tiles };
      if (tool === "eraser") {
        delete next[key];
      } else {
        next[key] = tool;
      }
      onChange(next);
    },
    [tiles, onChange, tool, gridKeys]
  );

  const hexFromEvent = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * WIDTH - WIDTH / 2;
      const svgY = ((e.clientY - rect.top) / rect.height) * HEIGHT - HEIGHT / 2;
      return pixelToHex(svgX, svgY, HEX_SIZE);
    },
    [WIDTH, HEIGHT, HEX_SIZE]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      painting.current = true;
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      const hex = hexFromEvent(e);
      paint(hex.q, hex.r);
    },
    [hexFromEvent, paint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!painting.current) return;
      const hex = hexFromEvent(e);
      paint(hex.q, hex.r);
    },
    [hexFromEvent, paint]
  );

  const handlePointerUp = useCallback(() => {
    painting.current = false;
  }, []);

  // Validation
  const start0Count = Object.values(tiles).filter((t) => t === "start0").length;
  const start1Count = Object.values(tiles).filter((t) => t === "start1").length;
  const tileCount = Object.keys(tiles).length;

  return (
    <div className="space-y-2">
      {/* Tool palette */}
      <div className="flex flex-wrap gap-1">
        {TOOLS.map((t) => {
          const isActive = tool === t;
          const tc = t === "eraser" ? null : TILE_COLORS[t];
          return (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`px-2 py-1 text-xs rounded cursor-pointer border-2 transition-all ${
                isActive
                  ? "border-yellow-400 bg-yellow-900/30 text-yellow-300"
                  : "border-[#555] bg-[#1a1a2e] text-gray-400 hover:border-gray-400"
              }`}
            >
              {t === "eraser" ? (
                <span>Eraser</span>
              ) : (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded-sm border"
                    style={{ backgroundColor: tc!.fill, borderColor: tc!.stroke }}
                  />
                  {tc!.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Hex grid canvas */}
      <svg
        viewBox={`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-[550px] touch-none cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {Array.from(gridKeys).map((key) => {
          const { q, r } = parseKey(key);
          const [cx, cy] = hexToPixel(q, r, HEX_SIZE);
          const tileType = tiles[key];
          const tc = tileType ? TILE_COLORS[tileType] : null;
          return (
            <g key={key}>
              <polygon
                points={hexPoints(cx, cy, HEX_SIZE - 1)}
                fill={tc ? tc.fill : "transparent"}
                stroke={tc ? tc.stroke : "#333"}
                strokeWidth={tc ? "1.5" : "0.8"}
                strokeDasharray={tc ? "none" : "3,3"}
              />
              {tc?.icon && (
                <text
                  x={cx}
                  y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={tileType === "start0" || tileType === "start1" ? "14" : "10"}
                  fill={tc.stroke}
                  opacity="0.7"
                >
                  {tc.icon}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Validation / stats */}
      <div className="text-xs text-gray-500 space-y-0.5">
        <div>{tileCount} tiles placed</div>
        <div className={start0Count === 0 ? "text-red-400" : "text-gray-500"}>
          Red starts: {start0Count}
        </div>
        <div className={start1Count === 0 ? "text-red-400" : "text-gray-500"}>
          Blue starts: {start1Count}
        </div>
        {start0Count !== start1Count && start0Count > 0 && start1Count > 0 && (
          <div className="text-yellow-400">Unequal start positions</div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            // Fill entire disk as normal tiles
            const next: Record<string, TileType> = {};
            for (const key of gridKeys) next[key] = "normal";
            onChange(next);
          }}
          className="px-2 py-1 text-xs cursor-pointer border border-[#555] rounded bg-[#1a1a2e] text-gray-400 hover:border-gray-400 transition-all"
        >
          Fill All
        </button>
        <button
          onClick={() => onChange({})}
          className="px-2 py-1 text-xs cursor-pointer border border-[#555] rounded bg-[#1a1a2e] text-gray-400 hover:border-gray-400 transition-all"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
