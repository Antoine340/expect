import { describe, expect, it } from "vite-plus/test";
import { BROWSER_TOOL_REFERENCE } from "../src/browser-tools";
import { buildExecutionSystemPrompt } from "../src/prompts";

const TOOL_NAMES = [
  "open",
  "playwright",
  "screenshot",
  "console_logs",
  "network_requests",
  "performance_metrics",
  "accessibility_audit",
  "close",
];

describe("BROWSER_TOOL_REFERENCE", () => {
  it("describes every tool the MCP server registers", () => {
    expect(BROWSER_TOOL_REFERENCE).toHaveLength(TOOL_NAMES.length);
    for (const [index, name] of TOOL_NAMES.entries()) {
      expect(BROWSER_TOOL_REFERENCE[index]).toContain(`${name}:`);
    }
  });

  it("names the options an agent cannot discover from the tool list alone", () => {
    const reference = BROWSER_TOOL_REFERENCE.join("\n");

    for (const option of ["depth", "locale", "deviceScaleFactor", "snapshotAfter", "resultFile"]) {
      expect(reference).toContain(option);
    }
  });

  it("reaches the agent driven by the execution system prompt", () => {
    const prompt = buildExecutionSystemPrompt();

    for (const line of BROWSER_TOOL_REFERENCE) {
      expect(prompt).toContain(line);
    }
  });
});
