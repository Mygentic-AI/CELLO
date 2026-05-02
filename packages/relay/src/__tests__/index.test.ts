import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("@cello/relay", () => {
  it("module is defined", () => {
    expect(pkg).toBeDefined();
  });
});
