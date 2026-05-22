import { PlaywrightCheck } from "checkly/constructs";
import { aiContextGroup } from "./ai-context.group.ts";

new PlaywrightCheck("checkly-skill-sync", {
  name: "Checkly skill sync",
  description:
    "Compares the Checkly skill included in checkly/checkly-plugin with the source skill in checkly/checkly-cli.",
  playwrightConfigPath: "../playwright.config.ts",
  include: ["skills/checkly/**"],
  activated: true,
  runParallel: false,
  group: aiContextGroup,
});
