import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App";

describe("pilot launch screen", () => {
  it("explains local multiplayer and exposes controls before launch", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("LOCAL MULTIPLAYER");
    expect(html).toContain("FLIGHT MANUAL");
    expect(html).toContain("ROOM ACCESS CODE");
    expect(html).not.toContain("PRIVATE ALPHA");
  });
});
