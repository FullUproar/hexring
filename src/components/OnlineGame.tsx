"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import usePartySocket from "partysocket/react";
import HexBoard from "./HexBoard";
import { Game } from "@/lib/engine";
import type { Move, GameState, Winner } from "@/lib/engine";

const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999";

interface OnlineGameProps {
  roomId: string;
  playerName: string;
}

export default function OnlineGame({ roomId, playerName }: OnlineGameProps) {
  const gameRef = useRef(new Game());
  const [state, setState] = useState<GameState | null>(null);
  const [myPlayer, setMyPlayer] = useState<0 | 1 | null>(null);
  const [opponentName, setOpponentName] = useState<string>("");
  const [players, setPlayers] = useState<[string, string]>(["", ""]);
  const [selectedPieceId, setSelectedPieceId] = useState<number | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [message, setMessage] = useState("Connecting...");
  const [phase, setPhase] = useState<
    "connecting" | "waiting" | "playing" | "gameover"
  >("connecting");
  const [winner, setWinner] = useState<Winner>(null);

  const ws = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    onOpen() {
      ws.send(JSON.stringify({ type: "join", playerName }));
      setPhase("connecting");
      setMessage("Joining room...");
    },
    onMessage(e) {
      const msg = JSON.parse(e.data);
      handleServerMessage(msg);
    },
    onClose() {
      setMessage("Disconnected from server.");
    },
  });

  const handleServerMessage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: any) => {
      switch (msg.type) {
        case "waiting":
          setPhase("waiting");
          setMessage(
            "Waiting for opponent... Share this link to invite them!"
          );
          break;

        case "assigned":
          setMyPlayer(msg.player);
          setOpponentName(msg.opponentName);
          break;

        case "start":
          gameRef.current.state = msg.state;
          setState({ ...msg.state });
          setPlayers(msg.players);
          setPhase("playing");
          setSelectedPieceId(null);
          setValidMoves([]);
          setMessage(
            msg.state.currentPlayer === myPlayer
              ? "Your turn — select a piece."
              : `${msg.players[msg.state.currentPlayer]}'s turn...`
          );
          break;

        case "update":
          gameRef.current.state = msg.state;
          setState({ ...msg.state });
          setSelectedPieceId(null);
          setValidMoves([]);
          if (msg.state.currentPlayer === myPlayer) {
            setMessage(`${msg.mover} moved. Your turn!`);
          } else {
            setMessage(`${msg.mover} moved. Waiting for opponent...`);
          }
          break;

        case "gameover":
          gameRef.current.state = msg.state;
          setState({ ...msg.state });
          setPhase("gameover");
          setSelectedPieceId(null);
          setValidMoves([]);
          setWinner(msg.winner);
          if (msg.winner === myPlayer) {
            setMessage("You win! " + msg.reason);
          } else if (msg.winner === "draw") {
            setMessage("Draw! " + msg.reason);
          } else {
            setMessage("You lost. " + msg.reason);
          }
          break;

        case "opponent_disconnected":
          setMessage("Opponent disconnected. Waiting for reconnect...");
          break;

        case "opponent_reconnected":
          setMessage("Opponent reconnected!");
          break;

        case "spectate_state":
          gameRef.current.state = msg.state;
          setState({ ...msg.state });
          setPlayers(msg.players);
          setPhase("playing");
          setMyPlayer(null); // spectator
          setMessage("Spectating...");
          break;

        case "error":
          setMessage(`Error: ${msg.message}`);
          break;
      }
    },
    [myPlayer]
  );

  // Update message when myPlayer changes and we have state
  useEffect(() => {
    if (phase === "playing" && state && myPlayer !== null) {
      if (state.currentPlayer === myPlayer) {
        setMessage("Your turn — select a piece.");
      }
    }
  }, [myPlayer, phase, state]);

  const handleHexClick = useCallback(
    (q: number, r: number) => {
      if (phase !== "playing" || !state || myPlayer === null) return;
      if (state.currentPlayer !== myPlayer) return;

      const game = gameRef.current;

      // Check if clicking a valid move destination
      const clickedMove = validMoves.find(
        (m) => m.destQ === q && m.destR === r
      );
      if (clickedMove) {
        // Send move to server
        ws.send(
          JSON.stringify({
            type: "move",
            move: {
              type: clickedMove.type,
              pieceId: clickedMove.pieceId,
              destQ: clickedMove.destQ,
              destR: clickedMove.destR,
            },
          })
        );
        setSelectedPieceId(null);
        setValidMoves([]);
        setMessage("Waiting for server...");
        return;
      }

      // Check if clicking own piece
      const clickedPiece = Object.values(state.pieces).find(
        (p) => p.q === q && p.r === r && p.player === myPlayer
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
        let msg = `${moves.length} moves available.`;
        if (captures) msg += ` ${captures} capture(s)!`;
        setMessage(msg);
        return;
      }

      // Deselect
      setSelectedPieceId(null);
      setValidMoves([]);
      setMessage("Your turn — select a piece.");
    },
    [phase, state, myPlayer, validMoves, ws]
  );

  const handleRematch = useCallback(() => {
    ws.send(JSON.stringify({ type: "rematch" }));
    setPhase("playing");
    setWinner(null);
  }, [ws]);

  const isMyTurn = state?.currentPlayer === myPlayer;
  const isSpectator = myPlayer === null && phase === "playing";

  // Piece counts
  const redCount = state
    ? Object.values(state.pieces).filter((p) => p.player === 0).length
    : 5;
  const blueCount = state
    ? Object.values(state.pieces).filter((p) => p.player === 1).length
    : 5;
  const killTarget = gameRef.current.board.config.killTarget;

  // Turn indicator
  let turnText: string;
  let turnColor: string;
  if (phase === "gameover") {
    turnText =
      winner === myPlayer
        ? "YOU WIN!"
        : winner === "draw"
          ? "DRAW!"
          : "YOU LOST";
    turnColor = "border-yellow-500 text-yellow-500";
  } else if (phase === "waiting") {
    turnText = "WAITING...";
    turnColor = "border-gray-500 text-gray-400";
  } else if (isSpectator) {
    turnText = "SPECTATING";
    turnColor = "border-gray-500 text-gray-400";
  } else if (isMyTurn) {
    turnText = "YOUR TURN";
    turnColor =
      myPlayer === 0
        ? "border-red-500 text-red-500"
        : "border-blue-500 text-blue-500";
  } else {
    turnText = "OPPONENT'S TURN";
    turnColor = "border-gray-500 text-gray-400";
  }

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/play/${roomId}`
      : "";

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 flex flex-col items-center p-4">
      <h1 className="text-3xl font-bold tracking-[4px] text-[#e8dcc8] mb-1">
        HEXRING
      </h1>
      <p className="text-sm text-gray-500 mb-3">
        {isSpectator
          ? `Spectating: ${players[0]} vs ${players[1]}`
          : myPlayer !== null
            ? `You are ${myPlayer === 0 ? "Red" : "Blue"} vs ${opponentName}`
            : "Online Game"}
      </p>

      <div className="flex gap-5 items-start flex-wrap justify-center">
        {/* Board */}
        <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4">
          {state ? (
            <HexBoard
              pieces={state.pieces}
              validMoves={validMoves}
              selectedPieceId={selectedPieceId}
              currentPlayer={state.currentPlayer}
              isInteractive={isMyTurn && phase === "playing"}
              onHexClick={handleHexClick}
            />
          ) : (
            <div className="w-[580px] h-[530px] flex items-center justify-center text-gray-500">
              {phase === "waiting"
                ? "Waiting for opponent..."
                : "Connecting..."}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="w-[300px] flex flex-col gap-3">
          {/* Turn indicator */}
          <div
            className={`bg-[#16213e] border-2 rounded-xl p-3 text-center text-lg font-bold ${turnColor}`}
          >
            {turnText}
          </div>

          {/* Share link (when waiting) */}
          {phase === "waiting" && (
            <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                Share this link
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-[#1a1a2e] border border-[#555] rounded px-2 py-1 text-sm text-gray-300"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="px-3 py-1 text-sm border border-[#555] rounded bg-[#1a1a2e] text-gray-200 hover:bg-[#2d3a5c] transition-all"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* Scoreboard */}
          {state && (
            <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4 flex justify-around">
              <div className="text-center">
                <div className="text-sm font-bold text-red-500">
                  {players[0] || "Red"}
                  {myPlayer === 0 ? " (you)" : ""}
                </div>
                <div className="text-4xl font-bold text-red-500">
                  {redCount}
                </div>
                <div className="text-xs text-gray-500">
                  {5 - blueCount}/{killTarget} kills
                </div>
              </div>
              <div className="text-2xl text-gray-600 self-center">vs</div>
              <div className="text-center">
                <div className="text-sm font-bold text-blue-500">
                  {players[1] || "Blue"}
                  {myPlayer === 1 ? " (you)" : ""}
                </div>
                <div className="text-4xl font-bold text-blue-500">
                  {blueCount}
                </div>
                <div className="text-xs text-gray-500">
                  {5 - redCount}/{killTarget} kills
                </div>
              </div>
            </div>
          )}

          {/* Status */}
          <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-4 min-h-[70px]">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Status
            </div>
            <div className="text-sm mt-1 leading-relaxed">{message}</div>
          </div>

          {/* Rematch button */}
          {phase === "gameover" && (
            <button
              onClick={handleRematch}
              className="w-full py-2.5 text-base cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-200 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all"
            >
              Rematch (swap colors)
            </button>
          )}

          {/* Back to menu */}
          <a
            href="/"
            className="w-full py-2.5 text-base text-center cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-200 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all block"
          >
            Back to Menu
          </a>

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
            First to {killTarget} kills wins!
          </div>
        </div>
      </div>
    </div>
  );
}
