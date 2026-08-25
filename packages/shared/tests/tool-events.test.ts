import { describe, expect, it } from "vite-plus/test";
import { ToolResult } from "../src/models";
import {
  artifactLines,
  findCloseOutput,
  isToolNamed,
  screenshotPathsFrom,
} from "../src/tool-events";

describe("isToolNamed", () => {
  it("matches the name the ACP adapter actually reports", () => {
    expect(isToolNamed("mcp__browser__close", "close")).toBe(true);
  });

  it("still matches a bare tool name", () => {
    expect(isToolNamed("close", "close")).toBe(true);
  });

  it("does not match a tool whose name merely ends in the same letters", () => {
    expect(isToolNamed("mcp__browser__force_close", "close")).toBe(false);
  });
});

describe("findCloseOutput", () => {
  const closeResult = (result: string, isError = false) =>
    new ToolResult({ toolCallId: "call-1", toolName: "mcp__browser__close", result, isError });

  it("ignores a close that failed", () => {
    expect(findCloseOutput([closeResult("Screenshot: /tmp/s0.png", true)])).toBeUndefined();
  });

  it("takes the last successful close", () => {
    const events = [
      closeResult("Screenshot: /tmp/first.png"),
      closeResult("Screenshot: /tmp/last.png"),
    ];
    expect(findCloseOutput(events)).toContain("/tmp/last.png");
  });
});

describe("screenshotPathsFrom", () => {
  it("keeps only the screenshot lines", () => {
    const lines = artifactLines(
      ["Browser closed.", "Playwright video: /tmp/v.webm", "Screenshot: /tmp/s0.png"].join("\n"),
    );
    expect(screenshotPathsFrom(lines)).toEqual(["/tmp/s0.png"]);
  });
});
