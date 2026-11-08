import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, isOnlineRoute, isSpaceRoute } from "./App";

it("opens Little London island by default", () => {
  expect(isSpaceRoute("")).toBe(false);
  expect(isSpaceRoute("?mode=skirmish")).toBe(false);
  expect(isSpaceRoute("?mode=legacy-online")).toBe(false);
  expect(isSpaceRoute("?mode=local-space")).toBe(true);
  expect(isOnlineRoute("")).toBe(false);
  expect(isOnlineRoute("?mode=legacy-online")).toBe(true);
  const html = renderToStaticMarkup(<App search="" />);
  expect(html).toContain("TAKE A WALK");
  expect(html).toContain("VIEW THE ISLAND");
  expect(html).not.toContain("CLOCKWORK");
  expect(html).not.toContain("SOLO FLIGHT");
  expect(html).not.toContain("ROOM ACCESS CODE");
  expect(html).not.toContain("Launch training");
});

it("keeps multiplayer and space flight on their own routes", () => {
  expect(renderToStaticMarkup(<App search="?mode=legacy-online" />)).toContain("Loading multiplayer flight");
  expect(renderToStaticMarkup(<App search="?mode=local-space" />)).toContain("Loading offline space flight");
});
