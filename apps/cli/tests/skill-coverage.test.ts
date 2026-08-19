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

  // HACK: asserting the command string alone once locked in `expect -m`, which parses as no
  // subcommand and only prints help. Resolve the subcommand against the CLI that registers it.
  it("delegates the full run through a subcommand the CLI actually registers", () => {
    const invocation = SKILL.match(/^expect (\S+)/m);
    expect(invocation).not.toBeNull();

    const subcommand = invocation?.[1];
    const cli = fs.readFileSync(path.join(import.meta.dirname, "../src/index.tsx"), "utf8");
    expect(cli).toContain(`.command("${subcommand}")`);

    for (const option of ["--target", "--output json", "-m"]) {
      expect(SKILL).toContain(option);
    }
  });
});
