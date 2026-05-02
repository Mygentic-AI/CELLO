import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("@cello/transport", () => {
  it("module is defined", () => {
    expect(pkg).toBeDefined();
  });
});
