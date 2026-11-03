import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { promisify } from "node:util";

import {
  createPackage,
  selectPackageFiles,
  toPortableManifest,
  toPortableMcpConfig,
} from "../scripts/package.ts";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");

describe("selectPackageFiles", () => {
  test("keeps only the files that ship verbatim", () => {
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
      "LICENSE",
      "README.md",
      "assets/checkly-logo.png",
      "skills/checkly/SKILL.md",
      "skills/playwright-best-practices-for-agents/references/auth.md",
    ]);
  });

  test("leaves out .app.json because directory submissions can't reference registered apps", () => {
    assert.ok(!selectPackageFiles([".app.json", "LICENSE"]).includes(".app.json"));
  });

  test("leaves out the compatibility manifests, which are rewritten as portable ones", () => {
    const selected = selectPackageFiles([".codex-plugin/plugin.json", ".mcp.json", "LICENSE"]);
    assert.deepEqual(selected, ["LICENSE"]);
  });
});

describe("toPortableManifest", () => {
  test("moves the OpenAI interface under extensions and drops compatibility fields", () => {
    const source = {
      name: "checkly",
      version: "1.0.0",
      description: "Checkly skills",
      author: { name: "Checkly" },
      homepage: "https://www.checklyhq.com",
      repository: "https://github.com/checkly/checkly-plugin",
      license: "Apache-2.0",
      keywords: ["checkly"],
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      apps: "./.app.json",
      interface: { displayName: "Checkly", logo: "./assets/checkly-logo.png" },
    };

    assert.deepEqual(toPortableManifest(source), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "checkly",
      version: "1.0.0",
      description: "Checkly skills",
      author: { name: "Checkly" },
      homepage: "https://www.checklyhq.com",
      repository: "https://github.com/checkly/checkly-plugin",
      license: "Apache-2.0",
      keywords: ["checkly"],
      extensions: {
        "com.openai": {
          interface: { displayName: "Checkly", logo: "./assets/checkly-logo.png" },
        },
      },
    });
  });

  test("merges the manifest's own OpenAI extension with the interface", () => {
    const portable = toPortableManifest({
      name: "checkly",
      interface: { displayName: "Checkly" },
      extensions: {
        "com.openai": {
          review: { test_cases: { positive: [], negative: [] }, commerce: false },
          publication: { release_notes: "Initial release." },
        },
      },
    });

    assert.deepEqual(portable.extensions, {
      "com.openai": {
        review: { test_cases: { positive: [], negative: [] }, commerce: false },
        publication: { release_notes: "Initial release." },
        interface: { displayName: "Checkly" },
      },
    });
  });

  test("never carries an apps reference into the OpenAI extension", () => {
    const portable = toPortableManifest({ name: "x", apps: "./.app.json", interface: {} });
    const openai = (portable.extensions as Record<string, Record<string, unknown>>)["com.openai"];
    assert.equal(portable.apps, undefined);
    assert.equal(openai.apps, undefined);
  });
});

describe("toPortableMcpConfig", () => {
  test("declares the portable transport, schema and OpenAI OAuth extension", () => {
    const source = {
      mcpServers: {
        checkly: {
          type: "http",
          url: "https://api.checklyhq.com/mcp",
          scopes: ["checkly:checks:read", "checkly:checks:run"],
        },
      },
    };

    assert.deepEqual(toPortableMcpConfig(source), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        checkly: {
          type: "streamable-http",
          url: "https://api.checklyhq.com/mcp",
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

  test("keeps a transport that is already portable", () => {
    const config = toPortableMcpConfig({
      mcpServers: { legacy: { type: "sse", url: "https://example.com/mcp" } },
    });

    assert.deepEqual(config.mcpServers.legacy, { type: "sse", url: "https://example.com/mcp" });
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

  test("zips the portable manifests alongside the verbatim files", async () => {
    const outFile = join(dir, "plugin.zip");
    const files = await createPackage({ root: ROOT, outFile });

    const { stdout } = await run("unzip", ["-Z1", outFile]);
    const entries = stdout.trim().split("\n").sort();

    assert.deepEqual(entries, [...files].sort());
    assert.ok(entries.includes("plugin.json"));
    assert.ok(entries.includes("mcp.json"));
    assert.ok(entries.includes("assets/checkly-logo.png"));
    assert.ok(entries.includes("skills/checkly/SKILL.md"));
    assert.ok(
      !entries.some((e) => e === ".env" || e.startsWith("test/") || e.startsWith("node_modules/")),
    );
    assert.ok(!entries.includes("package.json"));
    // The compatibility layout is replaced, not shipped beside the portable one.
    assert.ok(!entries.includes(".codex-plugin/plugin.json"));
    assert.ok(!entries.includes(".mcp.json"));
    assert.ok(!entries.includes(".app.json"));
  });

  test("writes a portable plugin.json without touching the repo manifest", async () => {
    const outFile = join(dir, "plugin.zip");
    const manifestPath = join(ROOT, ".codex-plugin", "plugin.json");
    const sourceBefore = await readFile(manifestPath, "utf8");

    await createPackage({ root: ROOT, outFile });

    const { stdout } = await run("unzip", ["-p", outFile, "plugin.json"]);
    const packaged = JSON.parse(stdout);
    const source = JSON.parse(sourceBefore);

    assert.equal(packaged.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    assert.equal(packaged.name, source.name);
    assert.equal(packaged.apps, undefined);
    assert.equal(packaged.mcpServers, undefined);
    assert.equal(packaged.skills, undefined);
    assert.deepEqual(packaged.extensions["com.openai"].interface, source.interface);
    // Review material lives in the ZIP: the portal shows it read-only.
    const review = packaged.extensions["com.openai"].review;
    assert.equal(review.test_cases.positive.length, 5);
    assert.equal(review.test_cases.negative.length, 3);
    for (const c of review.test_cases.positive) {
      for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
        assert.ok(c[field], `positive case missing ${field}`);
      }
    }
    for (const c of review.test_cases.negative) {
      assert.ok(c.description && c.prompt);
    }
    assert.equal(await readFile(manifestPath, "utf8"), sourceBefore);
  });

  test("writes a portable mcp.json without touching the repo file", async () => {
    const outFile = join(dir, "plugin.zip");
    const mcpPath = join(ROOT, ".mcp.json");
    const sourceBefore = await readFile(mcpPath, "utf8");

    await createPackage({ root: ROOT, outFile });

    const { stdout } = await run("unzip", ["-p", outFile, "mcp.json"]);
    const packaged = JSON.parse(stdout);
    const server = packaged.mcpServers.checkly;
    const auth = server.extensions["com.openai"].auth;

    assert.equal(packaged.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    assert.equal(server.type, "streamable-http");
    assert.equal(server.url, JSON.parse(sourceBefore).mcpServers.checkly.url);
    // `scopes` is a Claude Code / Codex field; the portable schema has no such key.
    assert.equal(server.scopes, undefined);
    assert.equal(auth.type, "oauth");
    assert.deepEqual(auth.client, { mode: "cimd" });
    assert.deepEqual(auth.baseScopes, JSON.parse(sourceBefore).mcpServers.checkly.scopes);
    // Without this the portal falls back to every scope the server advertises,
    // which would grant checkly:environment-variables:write again.
    assert.deepEqual(auth.defaultScopes, []);
    assert.equal(await readFile(mcpPath, "utf8"), sourceBefore);
  });
});
