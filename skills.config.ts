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
    },
    {
      name: "playwright-best-practices-for-agents",
      source: {
        repo: "checkly/docs",
        path: "skills/playwright-best-practices-for-agents",
        ref: "main",
      },
    },
  ],
};
