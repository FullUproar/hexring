"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import HexBoard from "./HexBoard";
import SettingsPanel from "./SettingsPanel";
import { Game } from "@/lib/engine";
import { DEFAULT_CONFIG } from "@/lib/engine";
import { aiChooseMove } from "@/lib/engine/ai";
import type { AIDifficulty } from "@/lib/engine/ai";
import type { Move, GameState, GameConfig, Winner } from "@/lib/engine";

type PlayerMode = "human" | "ai";

interface HistoryEntry {
  state: GameState;
}

const DIFFICULTY_LABELS: Record<AIDifficulty, string> = {
  1: "Beginner",
  2: "Casual",
  3: "Intermediate",
  4: "Advanced",
  5: "Expert",
  6: "Master",
};

export default function GamePage() {
  const [config, setConfig] = useState<GameConfig>(() => DEFAULT_CONFIG);
  const gameRef = useRef(new Game(config));
  const [state, setState] = useState<GameState>(() => gameRef.current.state);
  const [selectedPieceId, setSelectedPieceId] = useState<number | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [message, setMessage] = useState("Red goes first — select a piece.");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [animOverride, setAnimOverride] = useState<{ pieceId: number; q: number; r: number } | null>(null);
  const animating = useRef(false);
  const [redMode, setRedMode] = useState<PlayerMode>("human");
  const [blueMode, setBlueMode] = useState<PlayerMode>("ai");
  const [difficulty, setDifficulty] = useState<AIDifficulty>(4);
  const aiThinking = useRef(false);

  const isAI = useCallback(
    (player: 0 | 1) => (player === 0 ? redMode : blueMode) === "ai",
    [redMode, blueMode]
  );

  const playerName = useCallback(
    (player: 0 | 1) => {
      const color = player === 0 ? "Red" : "Blue";
      return isAI(player) ? `AI ${color}` : color;
    },
    [isAI]
  );

  const killTarget = config.killTarget;
  const piecesPerPlayer = config.piecesPerPlayer;

  const redCount = Object.values(state.pieces).filter(
    (p) => p.player === 0
  ).length;
  const blueCount = Object.values(state.pieces).filter(
    (p) => p.player === 1
  ).length;
  const redKills = piecesPerPlayer - blueCount;
  const blueKills = piecesPerPlayer - redCount;

  // --- Finalize a move (apply game state, update messages) ---
  const finishMove = useCallback(
    (move: Move, desc: string, game: Game) => {
      const result = game.executeTurn(move);
      setSelectedPieceId(null);
      setValidMoves([]);
      setAnimOverride(null);
      animating.current = false;

      if (result.winner !== null) {
        const winMsg =
          result.winner === 0
            ? "RED WINS!"
            : result.winner === 1
              ? "BLUE WINS!"
              : "DRAW!";
        setMessage(`${desc} — ${winMsg}`);
        setState({ ...game.state });
        return;
      }

      const nextName = playerName(game.state.currentPlayer);
      const nextIsAI =
        (game.state.currentPlayer === 0 ? redMode : blueMode) === "ai";
      if (nextIsAI) {
        setMessage(`${desc} — ${nextName} is thinking...`);
      } else {
        setMessage(`${desc} — ${nextName}'s turn.`);
      }
      setState({ ...game.state });
    },
    [playerName, redMode, blueMode]
  );

  // --- Execute a move (human or AI) ---
  const executeMove = useCallback(
    (move: Move, game: Game, currentState: GameState) => {
      // Save history
      const snap = game.snapshot(currentState);
      setHistory((prev) => [...prev, { state: snap }]);

      const name = playerName(currentState.currentPlayer);
      let desc = "";
      if (move.type === "MOVE")
        desc = `${name} moves to (${move.destQ},${move.destR})`;
      else if (move.type === "PUSH") {
        const [pq, pr] = move.pushDest!;
        if (!game.board.onBoard(pq, pr))
          desc = `${name} PUSHES enemy OFF THE BOARD!`;
        else if (game.board.isKillbox(pq, pr))
          desc = `${name} PUSHES enemy INTO KILLBOX!`;
        else desc = `${name} pushes enemy to (${pq},${pr})`;
      } else if (move.type === "JUMP") {
        desc = move.isCapture
          ? `${name} JUMP CAPTURES enemy!`
          : `${name} jumps over friendly`;
        if (move.sacrifice) desc += " (SACRIFICE!)";
      } else if (move.type === "CHAIN_JUMP") {
        desc = `${name} CHAIN JUMPS (${move.chainTargets!.length} hops)`;
        if (move.enemyKills) desc += ` — ${move.enemyKills} CAPTURED!`;
      }

      setSelectedPieceId(null);
      setValidMoves([]);

      // Animate chain jumps through intermediate hops
      if (move.type === "CHAIN_JUMP" && move.chainHops && move.chainHops.length > 1) {
        animating.current = true;
        const piece = currentState.pieces[move.pieceId];
        if (!piece) {
          finishMove(move, desc, game);
          return;
        }
        // Build hop positions: start -> hop1 -> hop2 -> ... -> final
        const hops = move.chainHops;
        let step = 0;

        // Start at piece's current position
        setAnimOverride({ pieceId: piece.id, q: piece.q, r: piece.r });

        const stepThrough = () => {
          if (step < hops.length) {
            setAnimOverride({ pieceId: piece.id, q: hops[step].q, r: hops[step].r });
            step++;
            setTimeout(stepThrough, 280);
          } else {
            finishMove(move, desc, game);
          }
        };
        // Start first hop after a brief delay for the transition to pick up the start position
        setTimeout(stepThrough, 50);
        return;
      }

      finishMove(move, desc, game);
    },
    [playerName, finishMove]
  );

  // --- AI turn ---
  useEffect(() => {
    if (state.winner !== null) return;
    if (!isAI(state.currentPlayer)) return;
    if (aiThinking.current) return;
    if (animating.current) return;

    aiThinking.current = true;
    const timer = setTimeout(() => {
      const game = gameRef.current;
      const move = aiChooseMove(game, game.state, difficulty);
      aiThinking.current = false;
      if (move) {
        executeMove(move, game, game.state);
      } else {
        // No moves — skip
        game.state.currentPlayer = (1 - game.state.currentPlayer) as 0 | 1;
        setMessage(
          `${playerName(
            (1 - game.state.currentPlayer) as 0 | 1
          )} has no moves. ${playerName(game.state.currentPlayer)}'s turn.`
        );
        setState({ ...game.state });
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      aiThinking.current = false;
    };
  }, [state, isAI, difficulty, executeMove, playerName]);

  // --- Click handler ---
  const handleHexClick = useCallback(
    (q: number, r: number) => {
      if (state.winner !== null) return;
      if (isAI(state.currentPlayer)) return;
      if (animating.current) return;

      const game = gameRef.current;

      // Check if clicking a valid move destination
      const clickedMove = validMoves.find(
        (m) => m.destQ === q && m.destR === r
      );
      if (clickedMove) {
        executeMove(clickedMove, game, game.state);
        return;
      }

      // Check if clicking own piece
      const clickedPiece = Object.values(state.pieces).find(
        (p) => p.q === q && p.r === r && p.player === state.currentPlayer
      );
      if (clickedPiece) {
        setSelectedPieceId(clickedPiece.id);
        const moves = game.genMoves(game.state, clickedPiece);
        setValidMoves(moves);
        const captures = moves.filter(
          (m) =>
            (m.type === "JUMP" && m.isCapture) ||
            (m.type === "CHAIN_JUMP" && (m.enemyKills ?? 0) > 0)
        ).length;
        const pushes = moves.filter((m) => m.type === "PUSH").length;
        let msg = `Selected piece. ${moves.length} moves.`;
        if (captures) msg += ` ${captures} capture(s)!`;
        if (pushes) msg += ` ${pushes} push(es).`;
        setMessage(msg);
        return;
      }

      // Deselect
      setSelectedPieceId(null);
      setValidMoves([]);
      setMessage(`${playerName(state.currentPlayer)}: select a piece.`);
    },
    [state, validMoves, isAI, executeMove, playerName]
  );

  // --- Undo ---
  const handleUndo = useCallback(() => {
    if (!history.length || state.winner !== null) return;
    const game = gameRef.current;

    // If playing vs AI, undo both moves
    if (
      history.length >= 2 &&
      !isAI(state.currentPlayer) &&
      isAI((1 - state.currentPlayer) as 0 | 1)
    ) {
      const newHistory = [...history];
      newHistory.pop(); // AI move
      const prev = newHistory.pop()!; // player move
      game.state = game.snapshot(prev.state);
      setHistory(newHistory);
    } else {
      const newHistory = [...history];
      const prev = newHistory.pop()!;
      game.state = game.snapshot(prev.state);
      setHistory(newHistory);
    }

    setSelectedPieceId(null);
    setValidMoves([]);
    setMessage(
      `Move undone. ${playerName(game.state.currentPlayer)}'s turn.`
    );
    setState({ ...game.state });
  }, [history, state.winner, state.currentPlayer, isAI, playerName]);

  // --- New game ---
  const handleNewGame = useCallback(() => {
    const game = gameRef.current;
    game.reset();
    setHistory([]);
    setSelectedPieceId(null);
    setValidMoves([]);
    aiThinking.current = false;
    setMessage(`New game! ${playerName(0)}'s turn.`);
    setState({ ...game.state });
  }, [playerName]);

  // --- Apply new config ---
  const handleConfigChange = useCallback(
    (newConfig: GameConfig) => {
      setConfig(newConfig);
      const game = new Game(newConfig);
      gameRef.current = game;
      setHistory([]);
      setSelectedPieceId(null);
      setValidMoves([]);
      aiThinking.current = false;
      setMessage(`Settings applied! ${playerName(0)}'s turn.`);
      setState({ ...game.state });
    },
    [playerName]
  );

  // Reset game when mode changes
  const handleRedModeChange = useCallback(
    (mode: PlayerMode) => {
      setRedMode(mode);
      // Defer reset to after state update
      setTimeout(() => {
        const game = gameRef.current;
        game.reset();
        setHistory([]);
        setSelectedPieceId(null);
        setValidMoves([]);
        aiThinking.current = false;
        const rName = mode === "ai" ? "AI Red" : "Red";
        setMessage(`New game! ${rName} goes first.`);
        setState({ ...game.state });
      }, 0);
    },
    []
  );

  const handleBlueModeChange = useCallback(
    (mode: PlayerMode) => {
      setBlueMode(mode);
      setTimeout(() => {
        const game = gameRef.current;
        game.reset();
        setHistory([]);
        setSelectedPieceId(null);
        setValidMoves([]);
        aiThinking.current = false;
        setMessage("New game! Red goes first.");
        setState({ ...game.state });
      }, 0);
    },
    []
  );

  // Turn indicator
  let turnText: string;
  let turnColor: string;
  if (state.winner !== null) {
    turnText =
      state.winner === 0
        ? "RED WINS!"
        : state.winner === 1
          ? "BLUE WINS!"
          : "DRAW!";
    turnColor = "border-yellow-500 text-yellow-500";
  } else if (state.currentPlayer === 0) {
    turnText = isAI(0) ? "RED AI THINKING..." : "RED'S TURN";
    turnColor = "border-red-500 text-red-500";
  } else {
    turnText = isAI(1) ? "BLUE AI THINKING..." : "BLUE'S TURN";
    turnColor = "border-blue-500 text-blue-500";
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 flex flex-col items-center p-4">
      <h1 className="text-3xl font-bold tracking-[4px] text-[#e8dcc8] mb-1">
        HEXRING
      </h1>
      <p className="text-sm text-gray-500 mb-3">
        {redMode === "ai" && blueMode === "ai"
          ? "AI vs AI — watch them battle!"
          : redMode === "human" && blueMode === "human"
            ? "2 Player — Red goes first"
            : redMode === "ai"
              ? "You are Blue — click a piece, then click where to move"
              : "You are Red — click a piece, then click where to move"}
      </p>

      <div className="flex gap-5 items-start flex-wrap justify-center">
        {/* Board */}
        <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4">
          <HexBoard
            pieces={state.pieces}
            validMoves={validMoves}
            selectedPieceId={selectedPieceId}
            currentPlayer={state.currentPlayer}
            isInteractive={!isAI(state.currentPlayer) && state.winner === null && !animating.current}
            onHexClick={handleHexClick}
            config={config}
            animOverride={animOverride}
          />
        </div>

        {/* Info panel */}
        <div className="w-[300px] flex flex-col gap-3">
          {/* Turn indicator */}
          <div
            className={`bg-[#16213e] border-2 rounded-xl p-3 text-center text-lg font-bold ${turnColor}`}
          >
            {turnText}
          </div>

          {/* Mode selectors */}
          <div className="flex gap-2">
            <label className="flex-1 text-sm text-gray-400">
              Red:{" "}
              <select
                value={redMode}
                onChange={(e) =>
                  handleRedModeChange(e.target.value as PlayerMode)
                }
                className="bg-[#1a1a2e] text-gray-200 border border-[#555] rounded px-1 py-0.5"
              >
                <option value="human">Human</option>
                <option value="ai">AI</option>
              </select>
            </label>
            <label className="flex-1 text-sm text-gray-400">
              Blue:{" "}
              <select
                value={blueMode}
                onChange={(e) =>
                  handleBlueModeChange(e.target.value as PlayerMode)
                }
                className="bg-[#1a1a2e] text-gray-200 border border-[#555] rounded px-1 py-0.5"
              >
                <option value="human">Human</option>
                <option value="ai">AI</option>
              </select>
            </label>
          </div>

          {/* AI difficulty */}
          {(redMode === "ai" || blueMode === "ai") && (
            <label className="text-sm text-gray-400">
              AI Level:{" "}
              <select
                value={difficulty}
                onChange={(e) =>
                  setDifficulty(Number(e.target.value) as AIDifficulty)
                }
                className="bg-[#1a1a2e] text-gray-200 border border-[#555] rounded px-1 py-0.5"
              >
                {([1, 2, 3, 4, 5, 6] as AIDifficulty[]).map((d) => (
                  <option key={d} value={d}>
                    {d} — {DIFFICULTY_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Scoreboard */}
          <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4 flex justify-around">
            <div className="text-center">
              <div className="text-sm font-bold text-red-500">
                {isAI(0) ? "AI Red" : "Red"}
              </div>
              <div className="text-4xl font-bold text-red-500">{redCount}</div>
              <div className="text-xs text-gray-500">
                {redKills}/{killTarget} kills
              </div>
            </div>
            <div className="text-2xl text-gray-600 self-center">vs</div>
            <div className="text-center">
              <div className="text-sm font-bold text-blue-500">
                {isAI(1) ? "AI Blue" : "Blue"}
              </div>
              <div className="text-4xl font-bold text-blue-500">
                {blueCount}
              </div>
              <div className="text-xs text-gray-500">
                {blueKills}/{killTarget} kills
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4 min-h-[70px]">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Status
            </div>
            <div className="text-sm mt-1 leading-relaxed">{message}</div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleNewGame}
              className="flex-1 py-2.5 text-base cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-200 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all"
            >
              New Game
            </button>
            <button
              onClick={handleUndo}
              className="flex-1 py-2.5 text-base cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-200 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all"
            >
              Undo
            </button>
          </div>
          <a
            href={`/play/${Math.random().toString(36).slice(2, 8)}`}
            className="w-full py-2.5 text-base text-center cursor-pointer border-2 border-emerald-700 rounded-md bg-[#1a1a2e] text-emerald-400 hover:bg-emerald-900/30 hover:border-emerald-500 transition-all block"
          >
            Play Online
          </a>

          {/* Settings */}
          <SettingsPanel config={config} onApply={handleConfigChange} />

          {/* Legend */}
          <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-3 text-xs leading-relaxed text-gray-400">
            <div className="text-sm text-gray-300 font-bold mb-1">
              How to Play
            </div>
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#0d0d1a] border border-[#555] mr-1 align-middle" />{" "}
            Killbox (death){" "}
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#5c4d3a] mr-1 align-middle" />{" "}
            Fortress (no push)
            <br />
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#4f4] mr-1 align-middle" />{" "}
            Move{" "}
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#f90] mr-1 align-middle" />{" "}
            Push{" "}
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#f44] mr-1 align-middle" />{" "}
            Capture{" "}
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#f0f] mr-1 align-middle" />{" "}
            Chain
            <br />
            {config.winCondition === "first_to_kills"
              ? `First to ${killTarget} kills wins!`
              : config.winCondition === "last_standing"
                ? "Reduce opponent to 1 piece to win!"
                : "Eliminate all enemy pieces to win!"}
          </div>
        </div>
      </div>
    </div>
  );
}
