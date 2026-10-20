import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { promisify } from "node:util";

import { createPackage, selectPackageFiles } from "../scripts/package.ts";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");

describe("selectPackageFiles", () => {
  test("keeps only what the Codex plugin needs at runtime", () => {
    const tracked = [
      ".codex-plugin/plugin.json",
      ".mcp.json",
      ".app.json",
      "LICENSE",
      "README.md",
      "assets/checkly-logo.png",
      "skills/checkly/SKILL.md",
      "skills/playwright-best-practices-for-agents/references/auth.md",
      // dev-only files that must never ship
      ".env",
      ".gitignore",
      ".github/workflows/verify.yml",
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      ".plugin/plugin.json",
      "package.json",
      "package-lock.json",
      "scripts/sync.ts",
      "skills.config.ts",
      "test/sync.test.ts",
      "tsconfig.json",
    ];

    assert.deepEqual(selectPackageFiles(tracked), [
      ".codex-plugin/plugin.json",
      ".mcp.json",
      ".app.json",
      "LICENSE",
      "README.md",
      "assets/checkly-logo.png",
      "skills/checkly/SKILL.md",
      "skills/playwright-best-practices-for-agents/references/auth.md",
    ]);
  });
});

describe("createPackage", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "checkly-plugin-package-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("zips the tracked plugin files from the repo root", async () => {
    const outFile = join(dir, "plugin.zip");
    const files = await createPackage({ root: ROOT, outFile });

    const { stdout } = await run("unzip", ["-Z1", outFile]);
    const entries = stdout.trim().split("\n").sort();

    assert.deepEqual(entries, [...files].sort());
    assert.ok(entries.includes(".codex-plugin/plugin.json"));
    assert.ok(entries.includes(".mcp.json"));
    assert.ok(entries.includes("assets/checkly-logo.png"));
    assert.ok(entries.includes("skills/checkly/SKILL.md"));
    assert.ok(
      !entries.some((e) => e === ".env" || e.startsWith("test/") || e.startsWith("node_modules/")),
    );
    assert.ok(!entries.includes("package.json"));
  });
});
