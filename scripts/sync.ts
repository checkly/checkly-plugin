import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  /** Files to copy from `<source.repo>/<source.path>/` into `skills/<name>/`. */
  files: [string, ...string[]];
};

export type Config = {
  skills: Skill[];
};

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

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

export async function sync({
  config,
  root = REPO_ROOT,
  fetchImpl = fetch as unknown as FetchLike,
}: {
  config: Config;
  root?: string;
  fetchImpl?: FetchLike;
}): Promise<WrittenEntry[]> {
  const written: WrittenEntry[] = [];
  for (const skill of config.skills) {
    const skillDir = join(root, "skills", skill.name);
    await mkdir(skillDir, { recursive: true });

    for (const file of skill.files) {
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
