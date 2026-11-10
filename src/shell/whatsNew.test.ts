import { describe, expect, it } from "vitest";
import { minorOf, whatsNew, WHATS_NEW } from "./whatsNew";

describe("What's new", () => {
  it("tells someone who used an earlier version, once per release, and a point release adds nothing", () => {
    expect(whatsNew("0.2.0", null, true)).toBe(WHATS_NEW["0.2"]);
    expect(whatsNew("0.2.0", "0.1", true)).toBe(WHATS_NEW["0.2"]);
    expect(whatsNew("0.2.1", "0.2", true)).toBeNull();
    expect(minorOf("0.2.3")).toBe("0.2");
  });

  it("says nothing at a first setup, or for a release with no news", () => {
    expect(whatsNew("0.2.0", null, false)).toBeNull();
    expect(whatsNew("0.1.4", null, true)).toBeNull();
  });
});
