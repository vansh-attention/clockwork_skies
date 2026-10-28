import { lazy, Suspense } from "react";
import { LegacyOnlineGame } from "./LegacyOnlineGame";
const SpaceGame = lazy(() => import("./space/SpaceGame").then(module => ({ default: module.SpaceGame })));
export function isSpaceRoute(search: string): boolean { return new URLSearchParams(search).get("mode") === "local-space"; }
export function isOnlineRoute(search: string): boolean { return new URLSearchParams(search).get("mode") === "legacy-online"; }
export function App({ search = typeof window === "undefined" ? "" : window.location.search }: { search?: string } = {}) {
  return isSpaceRoute(search) ? <Suspense fallback={<p role="status">Loading offline space flight…</p>}><SpaceGame /></Suspense> : <LegacyOnlineGame offline={!isOnlineRoute(search)} />;
}
