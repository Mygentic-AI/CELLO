import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("@cello-protocol/e2e-tests", () => {
  it("module is defined", () => {
    expect(pkg).toBeDefined();
  });
});
