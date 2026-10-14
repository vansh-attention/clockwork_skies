import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("ships its launch screen without remote font or stylesheet dependencies", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  expect(css).not.toMatch(/@import|https?:\/\//);
});
