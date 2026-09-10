import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const EXPECTED_CHECKLY_SCOPES = [
  "checkly:account:read",
  "checkly:account:invite",
  "checkly:checks:read",
  "checkly:checks:write",
  "checkly:checks:run",
  "checkly:incidents:read",
  "checkly:incidents:write",
  "checkly:environment-variables:read",
  "checkly:environment-variables:write",
  "checkly:status-pages:read",
  "checkly:rca:read",
  "checkly:rca:run",
  "checkly:test-sessions:read",
  "checkly:assets:read",
  "checkly:usage:read",
];

test("Checkly MCP requests every supported OAuth scope", async () => {
  const config = JSON.parse(await readFile(join(import.meta.dirname, "..", ".mcp.json"), "utf8"));

  assert.deepEqual(config.mcpServers.checkly.scopes, EXPECTED_CHECKLY_SCOPES);
});
