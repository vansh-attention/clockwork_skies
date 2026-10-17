import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SpaceGame } from "./SpaceGame";

it("shows local flight choices, accessible instruments, and settings without an online gate", () => {
  const html = renderToStaticMarkup(<SpaceGame />);
  expect(html).toContain("Launch training");
  expect(html).toContain("Launch skirmish");
  expect(html).toContain("Keyboard flight");
  expect(html).toContain("Reduced motion");
  expect(html).toContain('aria-label="Flight instruments"');
  expect(html).toContain('data-testid="hull"');
  expect(html).toContain('data-testid="speed"');
  expect(html).not.toContain("ROOM ACCESS CODE");
  expect(html).not.toContain("CALLSIGN");
});
