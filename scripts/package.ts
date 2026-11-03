import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const run = promisify(execFile);

/**
 * Files that ship verbatim in the plugin ZIP. Everything else in the repo is
 * tooling (sync script, tests, CI, other agents' manifests) and must not ship.
 *
 * OpenAI requires the ZIP to contain a single plugin root with no secrets, so
 * the list is built from `git ls-files` and filtered here: untracked files
 * such as `.env` or `node_modules/` can never slip in.
 *
 * `.app.json` stays out: directory submissions can't reference a registered
 * MCP app ("Directory submissions must use With MCP and submit the MCP server
 * directly"). The repo keeps it for local Codex installs.
 *
 * The two compatibility manifests stay out as well, because the ZIP ships the
 * portable manifests generated from them instead.
 */
const PACKAGE_FILES = new Set(["LICENSE", "README.md"]);
const PACKAGE_DIRS = ["assets/", "skills/"];

/** Compatibility manifests in the repo: the source for the portable ones. */
const SOURCE_MANIFEST = ".codex-plugin/plugin.json";
const SOURCE_MCP = ".mcp.json";

/** Portable manifests written into the ZIP root. */
const PORTABLE_MANIFEST = "plugin.json";
const PORTABLE_MCP = "mcp.json";

const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/** Agent Plugins manifest fields. Everything else is client-specific. */
const PORTABLE_FIELDS = [
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
] as const;

/** The repo declares Claude Code's `http`; the portable schema calls it this. */
const PORTABLE_TRANSPORTS: Record<string, string> = { http: "streamable-http" };

type Manifest = { interface?: Record<string, unknown>; [key: string]: unknown };
type McpServer = { type?: string; scopes?: string[]; [key: string]: unknown };
type McpConfig = { mcpServers: Record<string, McpServer>; [key: string]: unknown };

/**
 * Turn the Codex compatibility manifest into the portable `plugin.json` the
 * plugin directory expects: identity at the root, OpenAI's presentation under
 * `extensions["com.openai"]`. "When extensions.com.openai is an object, it
 * replaces the entire .codex-plugin/plugin.json overlay", so the ZIP ships one
 * manifest, not both.
 *
 * `skills` and `mcpServers` are dropped because portable packages discover
 * those by path (`skills/`, `mcp.json`), and the manifest schema has no such
 * fields. `apps` is dropped because `.app.json` isn't shipped and a directory
 * submission may not reference a registered app.
 */
export function toPortableManifest(manifest: Manifest): Manifest {
  const portable: Manifest = { $schema: PLUGIN_SCHEMA };
  for (const field of PORTABLE_FIELDS) {
    if (manifest[field] !== undefined) portable[field] = manifest[field];
  }
  if (manifest.interface) {
    portable.extensions = { "com.openai": { interface: manifest.interface } };
  }
  return portable;
}

/**
 * Turn the repo's `.mcp.json` into the portable `mcp.json`.
 *
 * The transport is renamed: the Agent Plugins schema knows `stdio`,
 * `streamable-http` and `sse`, and the repo's `http` is the Claude Code and
 * Codex spelling that those clients read on a marketplace install. The portal
 * recorded a plugin uploaded with `http` as `transport: "http"` and attached no
 * app to it, so the portable name is what a submission should carry.
 *
 * OpenAI reads OAuth settings from `extensions["com.openai"].auth`, which the
 * repo file never declares, so the scopes move to `baseScopes` and the
 * top-level `scopes` key - which the portable schema has no field for - is
 * dropped.
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
 */
export function toPortableMcpConfig(config: McpConfig): McpConfig {
  const mcpServers = Object.fromEntries(
    Object.entries(config.mcpServers).map(([name, { type, scopes, ...server }]) => [
      name,
      {
        ...(type ? { type: PORTABLE_TRANSPORTS[type] ?? type } : {}),
        ...server,
        ...(scopes?.length
          ? {
              extensions: {
                "com.openai": {
                  auth: {
                    type: "oauth",
                    client: { mode: "cimd" },
                    baseScopes: scopes,
                    defaultScopes: [],
                  },
                },
              },
            }
          : {}),
      },
    ]),
  );
  return { $schema: MCP_SCHEMA, mcpServers };
}

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
}: {
  root: string;
  outFile: string;
}): Promise<string[]> {
  const verbatim = selectPackageFiles(await listTrackedFiles(root));
  await mkdir(dirname(outFile), { recursive: true });
  await rm(outFile, { force: true });
  // -X drops extra file attributes so the archive is reproducible across machines.
  await run("zip", ["-X", "-q", outFile, ...verbatim], { cwd: root });

  const manifest = toPortableManifest(
    JSON.parse(await readFile(join(root, SOURCE_MANIFEST), "utf8")),
  );
  const mcpConfig = toPortableMcpConfig(JSON.parse(await readFile(join(root, SOURCE_MCP), "utf8")));
  const staging = await mkdtemp(join(tmpdir(), "checkly-plugin-manifest-"));
  try {
    await writeFile(join(staging, PORTABLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(staging, PORTABLE_MCP), `${JSON.stringify(mcpConfig, null, 2)}\n`);
    await run("zip", ["-X", "-q", resolve(outFile), PORTABLE_MANIFEST, PORTABLE_MCP], {
      cwd: staging,
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return [...verbatim, PORTABLE_MANIFEST, PORTABLE_MCP];
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
  const files = await createPackage({ root: REPO_ROOT, outFile });
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
