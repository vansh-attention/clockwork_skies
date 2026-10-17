import { lazy, Suspense } from "react";
import { SpaceGame } from "./space/SpaceGame";
const LegacyOnlineGame = lazy(() => import("./LegacyOnlineGame").then(module => ({ default: module.LegacyOnlineGame })));
export function isLegacyRoute(search: string): boolean { return new URLSearchParams(search).get("mode") === "legacy-online"; }
export function App({ search = typeof window === "undefined" ? "" : window.location.search }: { search?: string } = {}) {
  return isLegacyRoute(search) ? <Suspense fallback={<p role="status">Loading legacy multiplayer…</p>}><LegacyOnlineGame /></Suspense> : <SpaceGame />;
}
