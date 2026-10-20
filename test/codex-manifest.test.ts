import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");

async function readManifest() {
  return JSON.parse(await readFile(join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));
}

function pngDimensions(buffer: Buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG", "expected a PNG file");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Limits from https://developers.openai.com/plugins/deploy/submission-errors
test("Codex listing text stays within OpenAI's final-submission limits", async () => {
  const { interface: ui } = await readManifest();

  assert.ok(ui.displayName.length <= 30, "displayName must be at most 30 characters");
  assert.ok(ui.shortDescription.length <= 30, "shortDescription must be at most 30 characters");
  assert.ok(ui.longDescription.length <= 4000, "longDescription must be at most 4000 characters");
  assert.ok(ui.developerName.length <= 80, "developerName must be at most 80 characters");
  assert.ok(ui.capabilities.length <= 20, "at most 20 capabilities");
  assert.ok(ui.defaultPrompt.length <= 3, "at most 3 starter prompts");
  for (const prompt of ui.defaultPrompt) {
    assert.ok(prompt.length <= 128, `starter prompt too long: ${prompt}`);
  }
});

test("Codex listing declares every URL OpenAI requires for a remote MCP plugin", async () => {
  const { interface: ui } = await readManifest();

  for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    assert.match(ui[key] ?? "", /^https:\/\//, `${key} must be an https URL`);
  }
});

test("Codex icon and logo point at an existing square PNG", async () => {
  const { interface: ui } = await readManifest();

  for (const key of ["composerIcon", "logo"]) {
    assert.match(ui[key], /^\.\/assets\/.+\.png$/, `${key} must be a ./assets PNG`);
    const { width, height } = pngDimensions(await readFile(join(ROOT, ui[key])));
    assert.equal(width, height, `${key} must be square`);
    assert.ok(width >= 48, `${key} must be at least 48px`);
  }
});
