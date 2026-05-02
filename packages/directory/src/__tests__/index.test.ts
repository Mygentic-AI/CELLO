import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("@cello/directory", () => {
  it("module is defined", () => {
    expect(pkg).toBeDefined();
  });
});
