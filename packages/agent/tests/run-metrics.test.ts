import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import { AcpSessionUpdate } from "@expect/shared/models";
import { EMPTY_RUN_METRICS, recordUpdate } from "../src/run-metrics";

const decode = Schema.decodeUnknownSync(AcpSessionUpdate);

const toolCall = (toolCallId: string, title: string) =>
  decode({ sessionUpdate: "tool_call", toolCallId, title, status: "pending" });

const toolCallUpdate = (toolCallId: string, status: string) =>
  decode({ sessionUpdate: "tool_call_update", toolCallId, status });

describe("recordUpdate", () => {
  it("counts each tool call and keeps a breakdown by title", () => {
    const metrics = [
      toolCall("1", "screenshot"),
      toolCall("2", "playwright"),
      toolCall("3", "screenshot"),
    ].reduce(recordUpdate, EMPTY_RUN_METRICS);

    expect(metrics.toolCalls).toBe(3);
    expect(metrics.callsByTitle).toEqual({ screenshot: 2, playwright: 1 });
  });

  it("counts only failed tool call updates as failures", () => {
    const metrics = [
      toolCall("1", "playwright"),
      toolCallUpdate("1", "in_progress"),
      toolCallUpdate("1", "failed"),
      toolCall("2", "playwright"),
      toolCallUpdate("2", "completed"),
    ].reduce(recordUpdate, EMPTY_RUN_METRICS);

    expect(metrics.toolCalls).toBe(2);
    expect(metrics.failedToolCalls).toBe(1);
  });

  it("ignores updates that are not tool activity", () => {
    const metrics = recordUpdate(
      EMPTY_RUN_METRICS,
      decode({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }),
    );

    expect(metrics).toEqual(EMPTY_RUN_METRICS);
  });
});
