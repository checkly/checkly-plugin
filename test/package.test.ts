import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { promisify } from "node:util";

import { createPackage, selectPackageFiles, toSubmissionMcpConfig } from "../scripts/package.ts";

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
      "LICENSE",
      "README.md",
      "assets/checkly-logo.png",
      "skills/checkly/SKILL.md",
      "skills/playwright-best-practices-for-agents/references/auth.md",
    ]);
  });

  test("leaves out .app.json because OpenAI rejects ZIPs with app references", () => {
    assert.ok(!selectPackageFiles([".app.json", ".mcp.json"]).includes(".app.json"));
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

  test("drops the apps reference from the manifest inside the ZIP", async () => {
    const outFile = join(dir, "plugin.zip");
    await createPackage({ root: ROOT, outFile });

    const { stdout } = await run("unzip", ["-p", outFile, ".codex-plugin/plugin.json"]);
    assert.equal(JSON.parse(stdout).apps, undefined);
    assert.equal(JSON.parse(stdout).mcpServers, "./.mcp.json");
  });

  test("overrides the manifest name inside the ZIP without touching the repo file", async () => {
    const outFile = join(dir, "plugin.zip");
    const manifestPath = join(ROOT, ".codex-plugin", "plugin.json");
    const sourceBefore = await readFile(manifestPath, "utf8");

    const files = await createPackage({ root: ROOT, outFile, pluginName: "app-test-id" });

    const { stdout: entriesOut } = await run("unzip", ["-Z1", outFile]);
    assert.deepEqual(entriesOut.trim().split("\n").sort(), [...files].sort());

    const { stdout } = await run("unzip", ["-p", outFile, ".codex-plugin/plugin.json"]);
    const packaged = JSON.parse(stdout);
    const source = JSON.parse(sourceBefore);
    assert.equal(packaged.name, "app-test-id");
    const { apps: _apps, ...sourceWithoutApps } = source;
    assert.deepEqual({ ...packaged, name: source.name }, sourceWithoutApps);
    assert.equal(await readFile(manifestPath, "utf8"), sourceBefore);
  });
});

describe("toSubmissionMcpConfig", () => {
  test("adds the OpenAI OAuth extension without altering the server declaration", () => {
    const source = {
      mcpServers: {
        checkly: {
          type: "http",
          url: "https://api.checklyhq.com/mcp",
          scopes: ["checkly:checks:read", "checkly:checks:run"],
        },
      },
    };

    assert.deepEqual(toSubmissionMcpConfig(source), {
      mcpServers: {
        checkly: {
          type: "http",
          url: "https://api.checklyhq.com/mcp",
          scopes: ["checkly:checks:read", "checkly:checks:run"],
          extensions: {
            "com.openai": {
              auth: {
                type: "oauth",
                client: { mode: "cimd" },
                baseScopes: ["checkly:checks:read", "checkly:checks:run"],
                defaultScopes: [],
              },
            },
          },
        },
      },
    });
  });

  test("leaves a server without scopes without an auth declaration", () => {
    const config = toSubmissionMcpConfig({
      mcpServers: { open: { type: "http", url: "https://example.com/mcp" } },
    });

    assert.deepEqual(config.mcpServers.open, {
      type: "http",
      url: "https://example.com/mcp",
    });
  });
});

describe("createPackage mcp config", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "checkly-plugin-mcp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("rewrites .mcp.json inside the ZIP without touching the repo file", async () => {
    const outFile = join(dir, "plugin.zip");
    const mcpPath = join(ROOT, ".mcp.json");
    const sourceBefore = await readFile(mcpPath, "utf8");

    await createPackage({ root: ROOT, outFile });

    const { stdout } = await run("unzip", ["-p", outFile, ".mcp.json"]);
    const packaged = JSON.parse(stdout);
    const server = packaged.mcpServers.checkly;

    assert.deepEqual(Object.keys(packaged), ["mcpServers"]);
    // The server declaration itself must survive untouched: the portal treats a
    // changed transport or URL as replacing the server and rejects the upload.
    const { extensions: _extensions, ...declaration } = server;
    assert.deepEqual(declaration, JSON.parse(sourceBefore).mcpServers.checkly);
    const auth = server.extensions["com.openai"].auth;
    assert.equal(auth.type, "oauth");
    assert.deepEqual(auth.client, { mode: "cimd" });
    assert.deepEqual(auth.baseScopes, JSON.parse(sourceBefore).mcpServers.checkly.scopes);
    // Without this the portal falls back to every scope the server advertises,
    // which would grant checkly:environment-variables:write again.
    assert.deepEqual(auth.defaultScopes, []);
    assert.equal(await readFile(mcpPath, "utf8"), sourceBefore);
  });
});
