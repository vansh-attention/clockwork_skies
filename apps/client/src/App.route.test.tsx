import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, isOnlineRoute, isSpaceRoute } from "./App";

it("opens the illustrated solo globe by default", () => {
  expect(isSpaceRoute("")).toBe(false);
  expect(isSpaceRoute("?mode=skirmish")).toBe(false);
  expect(isSpaceRoute("?mode=legacy-online")).toBe(false);
  expect(isSpaceRoute("?mode=local-space")).toBe(true);
  expect(isOnlineRoute("")).toBe(false);
  expect(isOnlineRoute("?mode=legacy-online")).toBe(true);
  const html = renderToStaticMarkup(<App search="" />);
  expect(html).toContain("SOLO FLIGHT");
  expect(html).not.toContain("ROOM ACCESS CODE");
  expect(html).not.toContain("Launch training");
});
