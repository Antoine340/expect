import type { AgentProvider } from "@expect/shared/models";
import type { AgentEffort } from "./types";

interface BuildSessionMetaOptions {
  readonly provider: AgentProvider;
  readonly systemPrompt?: string;
  readonly effort?: AgentEffort;
  readonly metadata?: {
    readonly isGitHubActions?: boolean;
  };
}

export const buildSessionMeta = ({
  provider,
  systemPrompt,
  effort,
  metadata,
}: BuildSessionMetaOptions) => {
  const resolvedEffort = effort ?? (metadata?.isGitHubActions ? "high" : undefined);

  const claudeCodeOptions = {
    ...(resolvedEffort ? { effort: resolvedEffort } : {}),
    ...(metadata?.isGitHubActions ? { thinking: { type: "adaptive" as const } } : {}),
  };

  const meta = {
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(provider === "claude" && Object.keys(claudeCodeOptions).length > 0
      ? { claudeCode: { options: claudeCodeOptions } }
      : {}),
  };

  if (Object.keys(meta).length === 0) return undefined;
  return meta;
};
