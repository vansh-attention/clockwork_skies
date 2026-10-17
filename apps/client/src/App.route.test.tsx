import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, isLegacyRoute } from "./App";

it("uses local space by default and reserves only the explicit legacy query", () => {
  expect(isLegacyRoute("")).toBe(false);
  expect(isLegacyRoute("?mode=skirmish")).toBe(false);
  expect(isLegacyRoute("?mode=legacy-online")).toBe(true);
  const html = renderToStaticMarkup(<App search="" />);
  expect(html).toContain("Launch training");
  expect(html).not.toContain("ROOM ACCESS CODE");
});
