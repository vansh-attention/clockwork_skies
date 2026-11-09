import { lazy, Suspense } from "react";
import { CityGame } from "./city/CityGame";
const SpaceGame = lazy(() => import("./space/SpaceGame").then(module => ({ default: module.SpaceGame })));
const LegacyOnlineGame = lazy(() => import("./LegacyOnlineGame").then(module => ({ default: module.LegacyOnlineGame })));
export function isSpaceRoute(search: string): boolean { return new URLSearchParams(search).get("mode") === "local-space"; }
export function isOnlineRoute(search: string): boolean { return new URLSearchParams(search).get("mode") === "legacy-online"; }
export function App({ search = typeof window === "undefined" ? "" : window.location.search }: { search?: string } = {}) {
  if (isSpaceRoute(search)) return <Suspense fallback={<p role="status">Loading offline space flight…</p>}><SpaceGame /></Suspense>;
  if (isOnlineRoute(search)) return <Suspense fallback={<p role="status">Loading multiplayer flight…</p>}><LegacyOnlineGame /></Suspense>;
  return <CityGame />;
}
