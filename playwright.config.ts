import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./checks",
  retries: process.env.CHECKLY ? 1 : 0,
});
