import type { Config } from "./scripts/sync.ts";

export const config: Config = {
  skills: [
    {
      name: "checkly",
      source: {
        repo: "checkly/checkly-cli",
        path: "skills/checkly",
        ref: "main",
      },
      files: ["SKILL.md", "README.md"],
    },
  ],
};
