import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const run = promisify(execFile);

/**
 * Files that go into the Codex plugin ZIP. Everything else in the repo is
 * tooling (sync script, tests, CI, other agents' manifests) and must not ship.
 *
 * OpenAI requires the ZIP to contain a single plugin root with no secrets, so
 * the list is built from `git ls-files` and filtered here: untracked files
 * such as `.env` or `node_modules/` can never slip in.
 *
 * `.app.json` stays out: OpenAI rejects ZIPs with app references and links the
 * MCP app in the dashboard instead. The repo keeps it for local Codex installs.
 */
const PACKAGE_FILES = new Set([".codex-plugin/plugin.json", ".mcp.json", "LICENSE", "README.md"]);
const PACKAGE_DIRS = ["assets/", "skills/"];

const MANIFEST = ".codex-plugin/plugin.json";
const MCP_CONFIG = ".mcp.json";

/** Both files are rewritten in a staging dir instead of copied from the repo. */
const REWRITTEN = [MANIFEST, MCP_CONFIG];

type McpServer = { type?: string; scopes?: string[]; [key: string]: unknown };
type McpConfig = { mcpServers: Record<string, McpServer>; [key: string]: unknown };

/**
 * Add the OAuth declaration the OpenAI plugin directory reads to each server in
 * the repo's `.mcp.json`. OpenAI takes its settings from
 * `extensions["com.openai"].auth`, which the repo file never declares, so the
 * submission portal has no auth configuration to open a connection with.
 *
 * The rewrite is strictly additive. The portal pins the MCP servers of an
 * existing plugin and rejects an upload that changes one: swapping `type` for
 * the Agent Plugins transport name `streamable-http` fails with "Adding,
 * removing, or replacing an MCP server isn't supported for existing plugins."
 * The transport, URL and `scopes` therefore stay exactly as the repo declares
 * them, which is also what Claude Code and Codex read on a marketplace install.
 *
 * `client.mode` is `cimd`: `auth.checklyhq.com` advertises no registration
 * endpoint, so Dynamic Client Registration is unavailable, and a `provided`
 * client would need a client ID we don't have. A Client Identifier Metadata
 * Document works - a connector created with it completed OAuth against the
 * tenant - and needs no client registration at all.
 *
 * `defaultScopes` is empty so only `baseScopes` is requested. ChatGPT otherwise
 * falls back to every scope the server advertises, which would grant
 * `checkly:environment-variables:write` and bring back the two environment
 * variable tools that OpenAI's review flagged as soliciting secrets.
 *
 * No `$schema` either: the portal validates this file against a closed model
 * and rejects the upload with "`$schema` is invalid: Extra inputs are not
 * permitted."
 */
export function toSubmissionMcpConfig(config: McpConfig): McpConfig {
  const mcpServers = Object.fromEntries(
    Object.entries(config.mcpServers).map(([name, server]) => [
      name,
      server.scopes?.length
        ? {
            ...server,
            extensions: {
              "com.openai": {
                auth: {
                  type: "oauth",
                  client: { mode: "cimd" },
                  baseScopes: server.scopes,
                  defaultScopes: [],
                },
              },
            },
          }
        : server,
    ]),
  );
  return { ...config, mcpServers };
}

/**
 * The OpenAI plugin directory pins the manifest `name` to the ID of the
 * existing listing and rejects re-uploads that don't match. The repo manifest
 * keeps `checkly` because the Codex marketplace install from GitHub uses it,
 * so the ID is only swapped in inside the submission ZIP.
 */
export const OPENAI_PLUGIN_NAME = "app-6a7f1be5a9e48191b23a7b6ae73cf976";

export function selectPackageFiles(trackedFiles: string[]): string[] {
  return trackedFiles.filter(
    (file) => PACKAGE_FILES.has(file) || PACKAGE_DIRS.some((dir) => file.startsWith(dir)),
  );
}

async function listTrackedFiles(root: string): Promise<string[]> {
  const { stdout } = await run("git", ["-C", root, "ls-files", "-z"]);
  return stdout.split("\0").filter(Boolean);
}

/**
 * Build the plugin ZIP at `outFile` from the tracked files under `root`.
 * Returns the list of files that were packaged.
 */
export async function createPackage({
  root,
  outFile,
  pluginName,
}: {
  root: string;
  outFile: string;
  /** Replaces the manifest `name` inside the ZIP; the repo file is left alone. */
  pluginName?: string;
}): Promise<string[]> {
  const files = selectPackageFiles(await listTrackedFiles(root));
  await mkdir(dirname(outFile), { recursive: true });
  await rm(outFile, { force: true });
  const fromRepo = files.filter((file) => !REWRITTEN.includes(file));
  // -X drops extra file attributes so the archive is reproducible across machines.
  await run("zip", ["-X", "-q", outFile, ...fromRepo], { cwd: root });
  // The manifest is always rewritten: `apps` points at `.app.json`, which isn't shipped.
  const { apps: _apps, ...manifest } = JSON.parse(await readFile(join(root, MANIFEST), "utf8"));
  const mcpConfig = toSubmissionMcpConfig(
    JSON.parse(await readFile(join(root, MCP_CONFIG), "utf8")),
  );
  const staging = await mkdtemp(join(tmpdir(), "checkly-plugin-manifest-"));
  try {
    await mkdir(join(staging, dirname(MANIFEST)), { recursive: true });
    await writeFile(
      join(staging, MANIFEST),
      `${JSON.stringify({ ...manifest, name: pluginName ?? manifest.name }, null, 2)}\n`,
    );
    await writeFile(join(staging, MCP_CONFIG), `${JSON.stringify(mcpConfig, null, 2)}\n`);
    await run("zip", ["-X", "-q", resolve(outFile), ...REWRITTEN], { cwd: staging });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return files;
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
    },
  });
  const manifest = JSON.parse(
    await readFile(join(REPO_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
  );
  const outFile = resolve(
    REPO_ROOT,
    values.out ?? join("dist", `${manifest.name}-plugin-${manifest.version}.zip`),
  );
  const files = await createPackage({ root: REPO_ROOT, outFile, pluginName: OPENAI_PLUGIN_NAME });
  for (const file of files) {
    console.log(`packaged ${file}`);
  }
  console.log(`\n${files.length} file(s) written to ${outFile}`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
