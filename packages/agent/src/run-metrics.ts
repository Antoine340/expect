import type { AcpSessionUpdate, AcpUsage } from "@expect/shared/models";

export interface RunMetrics {
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  // HACK: keyed by the ACP display title, not the tool name — the protocol carries no other
  // identifier on a tool_call, and reading rawInput would put tool arguments in the logs.
  readonly callsByTitle: Readonly<Record<string, number>>;
  readonly usage: AcpUsage | undefined;
}

export const EMPTY_RUN_METRICS: RunMetrics = {
  toolCalls: 0,
  failedToolCalls: 0,
  callsByTitle: {},
  usage: undefined,
};

export const recordUpdate = (metrics: RunMetrics, update: AcpSessionUpdate): RunMetrics => {
  if (update.sessionUpdate === "tool_call") {
    return {
      ...metrics,
      toolCalls: metrics.toolCalls + 1,
      callsByTitle: {
        ...metrics.callsByTitle,
        [update.title]: (metrics.callsByTitle[update.title] ?? 0) + 1,
      },
    };
  }

  if (update.sessionUpdate === "tool_call_update" && update.status === "failed") {
    return { ...metrics, failedToolCalls: metrics.failedToolCalls + 1 };
  }

  return metrics;
};
