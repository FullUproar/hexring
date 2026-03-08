"use client";

import { useState } from "react";
import type { GameConfig, WinCondition, StartLayout } from "@/lib/engine";
import { DEFAULT_CONFIG } from "@/lib/engine";

interface SettingsPanelProps {
  config: GameConfig;
  onApply: (config: GameConfig) => void;
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-gray-300">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 bg-[#1a1a2e] text-gray-200 border border-[#555] rounded px-2 py-0.5 text-center"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm cursor-pointer">
      <span className="text-gray-300">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-emerald-500"
      />
    </label>
  );
}

export default function SettingsPanel({ config, onApply }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GameConfig>({ ...config });

  const set = <K extends keyof GameConfig>(key: K, val: GameConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  if (!open) {
    return (
      <button
        onClick={() => {
          setDraft({ ...config });
          setOpen(true);
        }}
        className="w-full py-2 text-sm cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-400 hover:bg-[#2d3a5c] hover:border-gray-400 hover:text-gray-200 transition-all"
      >
        Settings
      </button>
    );
  }

  return (
    <div className="bg-[#16213e] border-2 border-[#555] rounded-xl p-4 space-y-3">
      <div className="text-sm font-bold text-gray-300 mb-2">Game Settings</div>

      {/* Board geometry */}
      <div className="text-xs text-gray-500 uppercase tracking-wider">
        Board
      </div>
      <NumberInput
        label="Board radius"
        value={draft.boardRadius}
        min={2}
        max={8}
        onChange={(v) => set("boardRadius", v)}
      />
      <NumberInput
        label="Killbox radius"
        value={draft.killboxRadius}
        min={0}
        max={draft.boardRadius - 1}
        onChange={(v) => set("killboxRadius", v)}
      />
      <NumberInput
        label="Fortress ring"
        value={draft.fortressRing}
        min={0}
        max={draft.boardRadius - 1}
        onChange={(v) => set("fortressRing", v)}
      />
      <NumberInput
        label="Pieces per player"
        value={draft.piecesPerPlayer}
        min={1}
        max={12}
        onChange={(v) => set("piecesPerPlayer", v)}
      />
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-gray-300">Start layout</span>
        <select
          value={draft.startLayout}
          onChange={(e) => set("startLayout", e.target.value as StartLayout)}
          className="bg-[#1a1a2e] text-gray-200 border border-[#555] rounded px-1 py-0.5 text-xs"
        >
          <option value="clustered">Clustered (grouped)</option>
          <option value="spread">Spread (interleaved)</option>
        </select>
      </label>

      {/* Win condition */}
      <div className="text-xs text-gray-500 uppercase tracking-wider mt-2">
        Win Condition
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-gray-300">Mode</span>
        <select
          value={draft.winCondition}
          onChange={(e) => set("winCondition", e.target.value as WinCondition)}
          className="bg-[#1a1a2e] text-gray-200 border border-[#555] rounded px-1 py-0.5 text-xs"
        >
          <option value="first_to_kills">First to N kills</option>
          <option value="last_standing">Last standing</option>
          <option value="eliminate_all">Eliminate all</option>
        </select>
      </label>
      {draft.winCondition === "first_to_kills" && (
        <NumberInput
          label="Kill target"
          value={draft.killTarget}
          min={1}
          max={draft.piecesPerPlayer}
          onChange={(v) => set("killTarget", v)}
        />
      )}
      <NumberInput
        label="Turn limit (0 = none)"
        value={draft.turnLimit}
        min={0}
        max={500}
        onChange={(v) => set("turnLimit", v)}
      />
      <Toggle
        label="Threefold repetition draw"
        checked={draft.threefoldRepetition}
        onChange={(v) => set("threefoldRepetition", v)}
      />

      {/* Push rules */}
      <div className="text-xs text-gray-500 uppercase tracking-wider mt-2">
        Push Rules
      </div>
      <Toggle
        label="Push enabled"
        checked={draft.pushEnabled}
        onChange={(v) => set("pushEnabled", v)}
      />
      {draft.pushEnabled && (
        <>
          <Toggle
            label="Push off board"
            checked={draft.pushOffBoard}
            onChange={(v) => set("pushOffBoard", v)}
          />
          <Toggle
            label="Push into killbox"
            checked={draft.pushIntoKillbox}
            onChange={(v) => set("pushIntoKillbox", v)}
          />
          <Toggle
            label="Fortress blocks push"
            checked={draft.fortressBlocksPush}
            onChange={(v) => set("fortressBlocksPush", v)}
          />
          <Toggle
            label="Chain push (push lines)"
            checked={draft.chainPush}
            onChange={(v) => set("chainPush", v)}
          />
          <Toggle
            label="Push after jump"
            checked={draft.pushAfterJump}
            onChange={(v) => set("pushAfterJump", v)}
          />
        </>
      )}

      {/* Jump rules */}
      <div className="text-xs text-gray-500 uppercase tracking-wider mt-2">
        Jump Rules
      </div>
      <Toggle
        label="Jump over friendly"
        checked={draft.jumpOverFriendly}
        onChange={(v) => set("jumpOverFriendly", v)}
      />
      <Toggle
        label="Jump over enemy"
        checked={draft.jumpOverEnemy}
        onChange={(v) => set("jumpOverEnemy", v)}
      />
      <Toggle
        label="Capture on jump"
        checked={draft.captureOnJump}
        onChange={(v) => set("captureOnJump", v)}
      />
      <Toggle
        label="Fortress blocks jump"
        checked={draft.fortressBlocksJump}
        onChange={(v) => set("fortressBlocksJump", v)}
      />
      <Toggle
        label="Sacrifice jumps (into killbox)"
        checked={draft.sacrificeJumps}
        onChange={(v) => set("sacrificeJumps", v)}
      />
      <Toggle
        label="Chain jumps"
        checked={draft.chainJumps}
        onChange={(v) => set("chainJumps", v)}
      />
      {draft.chainJumps && (
        <NumberInput
          label="Max chain length"
          value={draft.maxChainLength}
          min={2}
          max={20}
          onChange={(v) => set("maxChainLength", v)}
        />
      )}

      {/* Deploy / Reinforcement */}
      <div className="text-xs text-gray-500 uppercase tracking-wider mt-2">
        Reinforcements
      </div>
      <Toggle
        label="Deploy enabled"
        checked={draft.deployEnabled}
        onChange={(v) => set("deployEnabled", v)}
      />
      {draft.deployEnabled && (
        <>
          <NumberInput
            label="Deploy zone (ring)"
            value={draft.deployZone}
            min={0}
            max={draft.boardRadius}
            onChange={(v) => set("deployZone", v)}
          />
          <NumberInput
            label="Reserve pieces"
            value={draft.reservePieces}
            min={1}
            max={12}
            onChange={(v) => set("reservePieces", v)}
          />
        </>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => {
            onApply(draft);
            setOpen(false);
          }}
          className="flex-1 py-2 text-sm cursor-pointer border-2 border-emerald-700 rounded-md bg-[#1a1a2e] text-emerald-400 hover:bg-emerald-900/30 hover:border-emerald-500 transition-all"
        >
          Apply & Reset
        </button>
        <button
          onClick={() => {
            setDraft({ ...DEFAULT_CONFIG });
          }}
          className="py-2 px-3 text-sm cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-400 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all"
        >
          Defaults
        </button>
        <button
          onClick={() => setOpen(false)}
          className="py-2 px-3 text-sm cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-400 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
