import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SKILL = fs.readFileSync(
  path.join(import.meta.dirname, "../../../packages/expect-skill/README.md"),
  "utf8",
);

describe("expect skill", () => {
  it("names every tool the MCP server registers", () => {
    for (const tool of [
      "open",
      "playwright",
      "screenshot",
      "console_logs",
      "network_requests",
      "performance_metrics",
      "accessibility_audit",
      "close",
    ]) {
      expect(SKILL).toContain(`**${tool}**`);
    }
  });

  // HACK: the skill is markdown and cannot import BROWSER_TOOL_REFERENCE, so an option shipped
  // without the skill following stays invisible to the agent. Keyword coverage rather than text
  // equality, since the skill legitimately formats the same facts differently.
  it("names the options an agent cannot discover from the tool list alone", () => {
    for (const option of [
      "depth=3",
      "locale",
      "deviceScaleFactor",
      "snapshotAfter",
      "resultFile",
    ]) {
      expect(SKILL).toContain(option);
    }
  });

  it("documents delegating a full run to the CLI", () => {
    expect(SKILL).toContain("expect -m");
    expect(SKILL).toContain("--target");
    expect(SKILL).toContain("--output json");
  });
});
