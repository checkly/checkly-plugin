import { defineConfig } from "checkly";
import { Frequency } from "checkly/constructs";

export default defineConfig({
  projectName: "Checkly Plugin and AI Context",
  logicalId: "checkly-plugin-and-ai-context",
  repoUrl: "https://github.com/checkly/checkly-plugin",
  checks: {
    activated: true,
    muted: false,
    runtimeId: "2026.04",
    frequency: Frequency.EVERY_24H,
    locations: ["eu-central-1"],
    tags: ["skills", "plugin", "sync"],
    checkMatch: "checks/**/*.check.ts",
  },
  cli: {
    runLocation: "eu-central-1",
  },
});
