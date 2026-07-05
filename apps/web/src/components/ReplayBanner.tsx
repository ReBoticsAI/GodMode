import { useEffect, useState } from "react";
import { api, connectWebSocket } from "../api";

interface ReplayRow {
  chart_number?: number;
  running?: number;
  speed?: number;
}

function applyReplayRows(rows: ReplayRow[]): { active: boolean; speed: number } {
  const active = rows.some((r) => r.running === 1);
  const first = rows.find((r) => r.running === 1);
  return { active, speed: first?.speed ?? 1 };
}

export function ReplayBanner() {
  const [active, setActive] = useState(false);
  const [speed, setSpeed] = useState(1);

  const syncFromApi = () => {
    api<ReplayRow[]>("/replay-state")
      .then((rows) => {
        const { active: a, speed: s } = applyReplayRows(rows);
        setActive(a);
        setSpeed(s);
      })
      .catch(() => {});
  };

  useEffect(() => {
    syncFromApi();
    const disconnect = connectWebSocket((raw) => {
      const msg = raw as { type: string; data?: ReplayRow };
      if (msg.type !== "sc_replay_state") return;
      syncFromApi();
    });
    return disconnect;
  }, []);

  if (!active) return null;

  return (
    <div
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-600/50 bg-amber-500/90 px-4 py-1 text-xs font-semibold text-amber-950"
      role="status"
    >
      REPLAY MODE — not live
      {speed !== 1 && (
        <span className="font-normal opacity-80">({speed.toFixed(1)}×)</span>
      )}
    </div>
  );
}
