import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CityGame } from "./CityGame";

it("opens on the hill-town title with the town clock and one way in", () => {
  const html = renderToStaticMarkup(<CityGame />);
  expect(html).toContain("HILL TOWN / CLOCKWORK PRIME");
  expect(html).toContain("TOWN CLOCK");
  expect(html).toContain("START THE ROUND");
  expect(html).toContain("LOOK AROUND");
  expect(html).toContain("Three deliveries across the town and the sky. WASD to walk, E to act.");
  expect(html).not.toContain("ENTER THE CITY");
  expect(html).toContain("EIGHT DISTRICTS · ONE CLOCK");
  expect(html).toContain('data-phase="title"');
  expect(html).not.toContain("CALLSIGN");
  expect(html).not.toContain("ROOM ACCESS CODE");
});
