import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("@cello/client", () => {
  it("module is defined", () => {
    expect(pkg).toBeDefined();
  });
});
