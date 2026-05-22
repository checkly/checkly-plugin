import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRawUrl } from "../scripts/sync.ts";
import { config } from "../skills.config.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function fetchText(request: APIRequestContext, url: string) {
  const response = await request.get(url);

  expect(response.ok(), `${url} should return a successful response`).toBe(true);

  return response.text();
}

for (const skill of config.skills) {
  test.describe(`included '${skill.name}' skill`, () => {
    for (const file of skill.files) {
      test(`${file} matches the ${skill.source.repo} source`, async ({ request }) => {
        const localPath = resolve(repoRoot, "skills", skill.name, file);
        const upstreamUrl = buildRawUrl({
          repo: skill.source.repo,
          ref: skill.source.ref,
          path: skill.source.path,
          file,
        });
        const [local, upstream] = await Promise.all([
          readFile(localPath, "utf8"),
          fetchText(request, upstreamUrl),
        ]);

        expect(local, `${localPath} should match ${upstreamUrl}`).toBe(upstream);
      });
    }
  });
}
