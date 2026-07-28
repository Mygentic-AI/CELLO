/**
 * M12 DOD-NODE-DIR-GCP-1 — what the node's systemd units reference must actually SHIP.
 *
 * The cloud-init template names absolute paths INSIDE the container image. Nothing at build time
 * connects the two: a script can exist in the repo, pass every test, and simply not be in the
 * image — and the failure surfaces at 04:17 UTC on a node nobody is watching, as a backup that
 * silently never ran. These tests tie the two files together.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PKG = resolve(import.meta.dirname, "../..");
const DOCKERFILE = readFileSync(resolve(PKG, "Dockerfile"), "utf8");
const CLOUD_INIT = readFileSync(
  resolve(PKG, "../../infra/terraform/templates/directory-cloud-init.yaml"),
  "utf8",
);

/** Absolute in-image paths the cloud-init units execute. */
function referencedImagePaths(): string[] {
  return [...CLOUD_INIT.matchAll(/(\/app\/[^\s"'\\]+)/g)].map((m) => m[1]!);
}

describe("DOD-NODE-DIR-GCP-1: the image contains what cloud-init runs", () => {
  it("references at least one in-image path — otherwise this test proves nothing", () => {
    expect(referencedImagePaths().length).toBeGreaterThan(0);
  });

  it("every /app path the node's systemd units execute exists in the repo and is COPYed", () => {
    for (const imagePath of new Set(referencedImagePaths())) {
      // /app/packages/directory/... maps to packages/directory/..., with dist/ produced by tsc.
      const rel = imagePath.replace("/app/packages/directory/", "");
      if (rel.startsWith("dist/")) {
        // Compiled output: assert the SOURCE exists, since dist/ is a build artifact.
        const src = rel.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
        expect(existsSync(resolve(PKG, src)), `${imagePath} → ${src} missing`).toBe(true);
        expect(DOCKERFILE, `${imagePath} — dist/ not copied`).toContain("packages/directory/dist/");
        continue;
      }
      expect(existsSync(resolve(PKG, rel)), `${imagePath} → ${rel} missing in repo`).toBe(true);
      // …and something in the Dockerfile must actually put it in the image.
      const dir = rel.split("/")[0]!;
      expect(
        DOCKERFILE.includes(`packages/directory/${rel}`) || DOCKERFILE.includes(`packages/directory/${dir}/`),
        `${imagePath} exists in the repo but no COPY in the Dockerfile ships it`,
      ).toBe(true);
    }
  });

  it("ships the backup script executable — the timer overrides the entrypoint to reach it", () => {
    expect(DOCKERFILE).toContain("COPY packages/directory/scripts/");
    expect(DOCKERFILE).toMatch(/chmod \+x \/app\/packages\/directory\/scripts/);
  });
});
