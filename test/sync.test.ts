import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { buildRawUrl, sync } from "../scripts/sync.ts";
import type { Config } from "../scripts/sync.ts";

function fakeFetch(responses: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    impl: async (url: string) => {
      calls.push(url);
      const response = responses[url];
      if (!response) {
        return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => response,
      };
    },
  };
}

describe("buildRawUrl", () => {
  test("composes raw.githubusercontent.com URLs", () => {
    const url = buildRawUrl({
      repo: "checkly/checkly-cli",
      ref: "main",
      path: "skills/checkly",
      file: "SKILL.md",
    });
    assert.equal(
      url,
      "https://raw.githubusercontent.com/checkly/checkly-cli/main/skills/checkly/SKILL.md",
    );
  });
});

describe("sync", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "checkly-plugin-sync-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("writes each declared file to skills/<name>/", async () => {
    const config: Config = {
      skills: [
        {
          name: "checkly",
          source: { repo: "checkly/checkly-cli", path: "skills/checkly", ref: "main" },
          files: ["SKILL.md", "README.md"],
        },
      ],
    };
    const fetcher = fakeFetch({
      "https://raw.githubusercontent.com/checkly/checkly-cli/main/skills/checkly/SKILL.md":
        "# skill body",
      "https://raw.githubusercontent.com/checkly/checkly-cli/main/skills/checkly/README.md":
        "# readme body",
    });

    const written = await sync({
      config,
      root,
      fetchImpl: fetcher.impl,
    });

    assert.equal(written.length, 2);
    assert.equal(
      await readFile(join(root, "skills", "checkly", "SKILL.md"), "utf8"),
      "# skill body",
    );
    assert.equal(
      await readFile(join(root, "skills", "checkly", "README.md"), "utf8"),
      "# readme body",
    );
  });

  test("fetches each skill from its pinned source.ref", async () => {
    const config: Config = {
      skills: [
        {
          name: "pinned",
          source: {
            repo: "acme/widgets",
            path: "skills/pinned",
            ref: "v1.2.3",
          },
          files: ["SKILL.md"],
        },
      ],
    };
    const fetcher = fakeFetch({
      "https://raw.githubusercontent.com/acme/widgets/v1.2.3/skills/pinned/SKILL.md": "pinned body",
    });

    await sync({
      config,
      root,
      fetchImpl: fetcher.impl,
    });

    assert.deepEqual(fetcher.calls, [
      "https://raw.githubusercontent.com/acme/widgets/v1.2.3/skills/pinned/SKILL.md",
    ]);
  });

  test("throws if upstream responds non-2xx", async () => {
    const config: Config = {
      skills: [
        {
          name: "missing",
          source: { repo: "acme/widgets", path: "skills/missing", ref: "main" },
          files: ["SKILL.md"],
        },
      ],
    };
    const fetcher = fakeFetch({});

    await assert.rejects(
      sync({ config, root, fetchImpl: fetcher.impl }),
      /Failed to fetch .* 404 Not Found/,
    );
  });
});
