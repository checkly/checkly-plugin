import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { buildRawUrl, sync } from "../scripts/sync.ts";
import type { Config } from "../scripts/sync.ts";

type FakeResponse = {
  body: string;
  ok?: boolean;
  status?: number;
  statusText?: string;
};

function fakeFetch(responses: Record<string, FakeResponse | string>) {
  const calls: { url: string; init?: { headers?: Record<string, string> } }[] = [];
  return {
    calls,
    impl: async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, init });
      const entry = responses[url];
      if (entry === undefined) {
        return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
      }
      const response = typeof entry === "string" ? { body: entry } : entry;
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        statusText: response.statusText ?? "OK",
        text: async () => response.body,
      };
    },
  };
}

function treesUrl(repo: string, ref: string): string {
  return `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`;
}

function tree(entries: { path: string; type: "blob" | "tree" }[], truncated = false): string {
  return JSON.stringify({ sha: "deadbeef", truncated, tree: entries });
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

  test("mirrors every blob under the skill's source path, including nested dirs", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "main")]: tree([
        { path: "skills/demo", type: "tree" },
        { path: "skills/demo/SKILL.md", type: "blob" },
        { path: "skills/demo/references", type: "tree" },
        { path: "skills/demo/references/a.md", type: "blob" },
        // Outside the skill path — must be ignored.
        { path: "skills/other/SKILL.md", type: "blob" },
        { path: "README.md", type: "blob" },
      ]),
      "https://raw.githubusercontent.com/acme/widgets/main/skills/demo/SKILL.md": "# skill",
      "https://raw.githubusercontent.com/acme/widgets/main/skills/demo/references/a.md": "# ref a",
    });

    const written = await sync({ config, root, fetchImpl: fetcher.impl });

    assert.equal(written.length, 2);
    assert.equal(await readFile(join(root, "skills", "demo", "SKILL.md"), "utf8"), "# skill");
    assert.equal(
      await readFile(join(root, "skills", "demo", "references", "a.md"), "utf8"),
      "# ref a",
    );
    // The out-of-path blobs were never fetched.
    const fetched = fetcher.calls.map((c) => c.url);
    assert.ok(!fetched.some((u) => u.includes("skills/other")));
    assert.ok(!fetched.some((u) => u.endsWith("/main/README.md")));
  });

  test("deletes local files that no longer exist upstream", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    // A stale file from a previous sync that upstream no longer has.
    await mkdir(join(root, "skills", "demo"), { recursive: true });
    await writeFile(join(root, "skills", "demo", "gone.md"), "stale");

    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "main")]: tree([{ path: "skills/demo/SKILL.md", type: "blob" }]),
      "https://raw.githubusercontent.com/acme/widgets/main/skills/demo/SKILL.md": "# skill",
    });

    await sync({ config, root, fetchImpl: fetcher.impl });

    await assert.rejects(readFile(join(root, "skills", "demo", "gone.md"), "utf8"));
    assert.equal(await readFile(join(root, "skills", "demo", "SKILL.md"), "utf8"), "# skill");
  });

  test("fetches the tree from the pinned source.ref", async () => {
    const config: Config = {
      skills: [
        { name: "pinned", source: { repo: "acme/widgets", path: "skills/pinned", ref: "v1.2.3" } },
      ],
    };
    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "v1.2.3")]: tree([
        { path: "skills/pinned/SKILL.md", type: "blob" },
      ]),
      "https://raw.githubusercontent.com/acme/widgets/v1.2.3/skills/pinned/SKILL.md": "pinned",
    });

    await sync({ config, root, fetchImpl: fetcher.impl });

    assert.equal(fetcher.calls[0]?.url, treesUrl("acme/widgets", "v1.2.3"));
  });

  test("sends an auth header when a token is provided", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "main")]: tree([{ path: "skills/demo/SKILL.md", type: "blob" }]),
      "https://raw.githubusercontent.com/acme/widgets/main/skills/demo/SKILL.md": "# skill",
    });

    await sync({ config, root, fetchImpl: fetcher.impl, token: "ghs_secret" });

    const treesCall = fetcher.calls.find((c) => c.url === treesUrl("acme/widgets", "main"));
    assert.equal(treesCall?.init?.headers?.Authorization, "Bearer ghs_secret");
  });

  test("throws if the tree is truncated", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "main")]: tree(
        [{ path: "skills/demo/SKILL.md", type: "blob" }],
        true,
      ),
    });

    await assert.rejects(sync({ config, root, fetchImpl: fetcher.impl }), /truncated/);
  });

  test("throws if the tree request responds non-2xx", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    const fetcher = fakeFetch({});

    await assert.rejects(
      sync({ config, root, fetchImpl: fetcher.impl }),
      /Failed to list .* 404 Not Found/,
    );
  });

  test("throws if a file fetch responds non-2xx", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "main")]: tree([{ path: "skills/demo/SKILL.md", type: "blob" }]),
      // No raw response registered → 404.
    });

    await assert.rejects(
      sync({ config, root, fetchImpl: fetcher.impl }),
      /Failed to fetch .* 404 Not Found/,
    );
  });

  test("rejects a skill name that is not a single path segment", async () => {
    for (const name of ["", ".", "..", "a/b", "a\\b"]) {
      const config: Config = {
        skills: [{ name, source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } }],
      };
      const fetcher = fakeFetch({});
      await assert.rejects(
        sync({ config, root, fetchImpl: fetcher.impl }),
        /Invalid skill name/,
        `expected ${JSON.stringify(name)} to be rejected`,
      );
      // Validation must run before any network call, so nothing is fetched.
      assert.equal(fetcher.calls.length, 0);
    }
  });

  test("refuses to write a tree entry that escapes the skill directory", async () => {
    const config: Config = {
      skills: [
        { name: "demo", source: { repo: "acme/widgets", path: "skills/demo", ref: "main" } },
      ],
    };
    const fetcher = fakeFetch({
      [treesUrl("acme/widgets", "main")]: tree([{ path: "skills/demo/../evil.md", type: "blob" }]),
      "https://raw.githubusercontent.com/acme/widgets/main/skills/demo/../evil.md": "pwned",
    });

    await assert.rejects(
      sync({ config, root, fetchImpl: fetcher.impl }),
      /outside the skill directory/,
    );
    // The traversal target must not have been written.
    await assert.rejects(readFile(join(root, "skills", "evil.md"), "utf8"));
  });
});
