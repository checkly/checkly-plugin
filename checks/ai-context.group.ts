import { AlertChannel, AlertEscalationBuilder, CheckGroupV2 } from "checkly/constructs";

export const aiContextGroup = new CheckGroupV2("ai-context", {
  name: "checkly-plugin & AI-Context",
  alertChannels: [AlertChannel.fromId(287691)],
  alertEscalationPolicy: AlertEscalationBuilder.runBasedEscalation(1),
});
