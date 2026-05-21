import { MultiStepCheck, RetryStrategyBuilder } from "checkly/constructs";

new MultiStepCheck("checkly-skill-sync", {
  name: "Checkly skill sync",
  description:
    "Compares the Checkly skill included in checkly/checkly-plugin with the source skill in checkly/checkly-cli.",
  code: {
    entrypoint: "./checkly-skill-sync.spec.ts",
  },
  activated: true,
  retryStrategy: RetryStrategyBuilder.singleRetry({
    baseBackoffSeconds: 60,
    sameRegion: true,
  }),
  runParallel: false,
});
