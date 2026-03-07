"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import OnlineGame from "@/components/OnlineGame";

export default function PlayRoom() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [playerName, setPlayerName] = useState("");
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] text-gray-200 flex flex-col items-center justify-center p-4">
        <h1 className="text-3xl font-bold tracking-[4px] text-[#e8dcc8] mb-6">
          HEXRING
        </h1>
        <div className="bg-[#16213e] border-2 border-[#333] rounded-xl p-8 w-full max-w-sm">
          <h2 className="text-lg font-bold mb-4 text-center">
            Join Game
          </h2>
          <p className="text-sm text-gray-400 mb-4 text-center">
            Room: <span className="text-gray-200 font-mono">{roomId}</span>
          </p>
          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && playerName.trim()) setJoined(true);
            }}
            className="w-full bg-[#1a1a2e] border border-[#555] rounded px-3 py-2 text-gray-200 mb-4"
            maxLength={20}
            autoFocus
          />
          <button
            onClick={() => playerName.trim() && setJoined(true)}
            disabled={!playerName.trim()}
            className="w-full py-2.5 text-base cursor-pointer border-2 border-[#555] rounded-md bg-[#1a1a2e] text-gray-200 hover:bg-[#2d3a5c] hover:border-gray-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Join Game
          </button>
        </div>
      </div>
    );
  }

  return <OnlineGame roomId={roomId} playerName={playerName} />;
}
