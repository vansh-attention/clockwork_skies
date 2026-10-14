import { useEffect, useRef } from "react";
import type { MatchEvent, MatchState } from "@clockwork/shared";
import { GameScene, type HudState } from "./GameScene";

export function GameCanvas({ state, event, sessionId, onReady, onHud }: {
  state: MatchState | null;
  event: MatchEvent | null;
  sessionId: string;
  onReady: (scene: GameScene) => void;
  onHud: (hud: HudState) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<GameScene | null>(null);
  useEffect(() => {
    if (!mount.current) return;
    scene.current = new GameScene(mount.current, onHud);
    onReady(scene.current);
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [onHud, onReady]);
  useEffect(() => { if (state) scene.current?.setState(state); }, [state]);
  useEffect(() => { if (event) scene.current?.flash(event); }, [event]);
  useEffect(() => { scene.current?.setIdentity(sessionId); }, [sessionId]);
  return <div className="game-canvas" ref={mount} />;
}
