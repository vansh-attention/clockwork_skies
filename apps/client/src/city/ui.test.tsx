import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CityGame } from "./CityGame";

it("opens on a compact London island with walking and overview controls", () => {
  const html = renderToStaticMarkup(<CityGame />);
  expect(html).toContain("A SMALL ISLAND. A LITTLE ESCAPE.");
  expect(html).not.toContain("CLOCKWORK");
  expect(html).toContain("ISLANDS");
  expect(html).toContain("TAKE A WALK");
  expect(html).toContain("VIEW THE ISLAND");
  expect(html).toContain("A painted little island, yours to wander.");
  expect(html).toContain("WASD to walk · Drag to look · Scroll to zoom");
  expect(html).not.toContain("ENTER THE CITY");
  expect(html).toContain("A PAINTED LONDON BY THE SEA");
  expect(html).toContain('data-phase="title"');
  expect(html).not.toContain("CALLSIGN");
  expect(html).not.toContain("ROOM ACCESS CODE");
});
