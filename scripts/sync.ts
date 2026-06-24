import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

export type Source = {
  /** GitHub repo in <owner>/<name> form. */
  repo: string;
  /** Path within the repo to the directory holding the skill files. */
  path: string;
  /** Branch, tag, or commit SHA to pull from. */
  ref: string;
};

export type Skill = {
  /** Directory name under `skills/`. Must match the skill's frontmatter `name`. */
  name: string;
  source: Source;
};

export type Config = {
  skills: Skill[];
};

type FetchInit = { headers?: Record<string, string> };

type FetchLike = (
  url: string,
  init?: FetchInit,
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

/** A single entry in a GitHub git-tree response. */
type TreeEntry = { path: string; type: "blob" | "tree" | "commit" };
type TreeResponse = { tree: TreeEntry[]; truncated: boolean };

export type WrittenEntry = {
  skill: string;
  file: string;
  url: string;
  dest: string;
};

export async function loadConfig(path: string): Promise<Config> {
  const mod = (await import(pathToFileURL(path).href)) as { config?: Config };
  if (!mod.config) {
    throw new Error(`Config file ${path} must export a named \`config\`.`);
  }
  return mod.config;
}

export function buildRawUrl({
  repo,
  ref,
  path,
  file,
}: {
  repo: string;
  ref: string;
  path: string;
  file: string;
}): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}/${file}`;
}

function buildTreesUrl({ repo, ref }: { repo: string; ref: string }): string {
  return `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`;
}

/**
 * A skill name becomes a directory under `skills/` that gets wiped and
 * rewritten. Reject anything that isn't a single path segment so a malformed
 * config (empty, `.`, `..`, or a path separator) can't make `rm` reach outside
 * `skills/`.
 */
function assertSafeSkillName(name: string): void {
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new Error(`Invalid skill name ${JSON.stringify(name)}: must be a single path segment.`);
  }
}

/** Guards `writeFile` against a tree entry whose path escapes its skill dir. */
function assertInsideSkillDir(skillDir: string, dest: string): void {
  const resolvedDir = resolve(skillDir);
  const resolvedDest = resolve(dest);
  if (resolvedDest !== resolvedDir && !resolvedDest.startsWith(resolvedDir + sep)) {
    throw new Error(`Refusing to write ${dest}: resolves outside the skill directory ${skillDir}.`);
  }
}

/**
 * Lists every file under `source.path`, relative to that path, by reading the
 * repo's git tree. Mirroring the whole directory keeps us in lockstep with
 * upstream: files added or removed there flow through without touching config.
 */
async function listSkillFiles(
  source: Source,
  fetchImpl: FetchLike,
  token?: string,
): Promise<string[]> {
  const url = buildTreesUrl(source);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to list ${url}: ${res.status} ${res.statusText}`);
  }

  const body = JSON.parse(await res.text()) as TreeResponse;
  // A truncated tree means GitHub capped the response and we'd silently miss
  // files. Fail loudly rather than mirror an incomplete skill.
  if (body.truncated) {
    throw new Error(
      `Tree for ${source.repo}@${source.ref} is truncated; cannot reliably mirror ${source.path}.`,
    );
  }

  const prefix = `${source.path.replace(/\/+$/, "")}/`;
  return body.tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
    .map((entry) => entry.path.slice(prefix.length));
}

export async function sync({
  config,
  root = REPO_ROOT,
  fetchImpl = fetch as unknown as FetchLike,
  token = process.env.GITHUB_TOKEN,
}: {
  config: Config;
  root?: string;
  fetchImpl?: FetchLike;
  token?: string;
}): Promise<WrittenEntry[]> {
  const written: WrittenEntry[] = [];
  for (const skill of config.skills) {
    assertSafeSkillName(skill.name);
    const files = await listSkillFiles(skill.source, fetchImpl, token);

    const skillDir = join(root, "skills", skill.name);
    // Wipe-and-rewrite so files deleted upstream don't linger locally. The
    // skill directory is fully owned by sync, so this is safe.
    await rm(skillDir, { recursive: true, force: true });
    await mkdir(skillDir, { recursive: true });

    for (const file of files) {
      const url = buildRawUrl({
        repo: skill.source.repo,
        ref: skill.source.ref,
        path: skill.source.path,
        file,
      });
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      }
      const body = await res.text();
      const dest = join(skillDir, file);
      assertInsideSkillDir(skillDir, dest);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
      written.push({ skill: skill.name, file, url, dest });
    }
  }
  return written;
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: "skills.config.ts" },
    },
  });
  const configPath = resolve(REPO_ROOT, values.config ?? "skills.config.ts");
  const config = await loadConfig(configPath);
  const written = await sync({ config });
  for (const { skill, file, url } of written) {
    console.log(`synced ${skill}/${file} from ${url}`);
  }
  console.log(`\n${written.length} file(s) synced`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
