import { expect, test, type APIRequestContext } from "@playwright/test";

const files = ["SKILL.md", "README.md"] as const;
const includedBaseUrl =
  "https://raw.githubusercontent.com/checkly/checkly-plugin/main/skills/checkly";
const originalBaseUrl = "https://raw.githubusercontent.com/checkly/checkly-cli/main/skills/checkly";

async function fetchText(request: APIRequestContext, url: string) {
  const response = await request.get(url);

  expect(response.ok(), `${url} should return a successful response`).toBe(true);

  return response.text();
}

test.describe("included Checkly skill", () => {
  for (const file of files) {
    test(`${file} matches the checkly-cli source`, async ({ request }) => {
      const includedUrl = `${includedBaseUrl}/${file}`;
      const originalUrl = `${originalBaseUrl}/${file}`;
      const [included, original] = await Promise.all([
        fetchText(request, includedUrl),
        fetchText(request, originalUrl),
      ]);

      expect(included, `${includedUrl} should match ${originalUrl}`).toBe(original);
    });
  }
});
