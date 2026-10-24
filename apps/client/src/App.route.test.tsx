import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, isSpaceRoute } from "./App";

it("uses the illustrated globe by default and reserves the offline space route", () => {
  expect(isSpaceRoute("")).toBe(false);
  expect(isSpaceRoute("?mode=skirmish")).toBe(false);
  expect(isSpaceRoute("?mode=legacy-online")).toBe(false);
  expect(isSpaceRoute("?mode=local-space")).toBe(true);
  const html = renderToStaticMarkup(<App search="" />);
  expect(html).toContain("ROOM ACCESS CODE");
  expect(html).not.toContain("Launch training");
});
