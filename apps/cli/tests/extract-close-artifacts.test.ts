import { describe, expect, it } from "vite-plus/test";
import { pathToFileURL } from "node:url";
import { Option } from "effect";
import {
  AcpToolCall,
  AcpToolCallUpdate,
  ChangesFor,
  ExecutedTestPlan,
  PlanId,
  RunStarted,
  TestPlan,
  ToolResult,
} from "@expect/shared/models";
import { extractCloseArtifacts } from "../src/utils/extract-close-artifacts";
import type { ExecutionEvent } from "@expect/shared/models";

// HACK: the ACP adapter names browser tools `mcp__browser__<tool>`, never the bare name — a
// fixture built with "close" passes against a parser the real pipeline never feeds.
const CLOSE_TOOL_NAME = "mcp__browser__close";

const makeCloseResult = (result: string): ExecutionEvent =>
  new ToolResult({ toolCallId: "call-close", toolName: CLOSE_TOOL_NAME, result, isError: false });

const makeErrorCloseResult = (result: string): ExecutionEvent =>
  new ToolResult({ toolCallId: "call-close", toolName: CLOSE_TOOL_NAME, result, isError: true });

const makeOtherToolResult = (result: string): ExecutionEvent =>
  new ToolResult({
    toolCallId: "call-snapshot",
    toolName: "mcp__browser__screenshot",
    result,
    isError: false,
  });

describe("extractCloseArtifacts", () => {
  describe("when no close event exists", () => {
    it("returns all undefined for empty events array", () => {
      const artifacts = extractCloseArtifacts([]);

      expect(artifacts.videoUrl).toBeUndefined();
      expect(artifacts.videoPath).toBeUndefined();
      expect(artifacts.screenshotPaths).toEqual([]);
    });

    it("returns all undefined when events have no close tool result", () => {
      const events: ExecutionEvent[] = [
        makeOtherToolResult("some result"),
        makeOtherToolResult("another result"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoUrl).toBeUndefined();
      expect(artifacts.videoPath).toBeUndefined();
    });

    it("returns all undefined when close result is an error", () => {
      const events: ExecutionEvent[] = [makeErrorCloseResult("Playwright video: /tmp/video.webm")];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoUrl).toBeUndefined();
    });

    it("returns all undefined when close result is empty", () => {
      const events: ExecutionEvent[] = [
        new ToolResult({
          toolCallId: "call-close",
          toolName: CLOSE_TOOL_NAME,
          result: "",
          isError: false,
        }),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoUrl).toBeUndefined();
    });
  });

  describe("extracting video path", () => {
    it("extracts video path and converts to file URL", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nPlaywright video: /tmp/videos/session.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/videos/session.webm");
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/videos/session.webm").href);
    });

    it("trims whitespace from video path", () => {
      const events: ExecutionEvent[] = [makeCloseResult("Playwright video:   /tmp/video.webm  ")];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/video.webm");
    });
  });

  describe("extracting screenshots", () => {
    it("extracts multiple screenshot paths", () => {
      const closeText = [
        "Browser closed.",
        "Playwright video: /tmp/video.webm",
        "Screenshot: /tmp/screenshot-0.png",
        "Screenshot: /tmp/screenshot-1.png",
      ].join("\n");
      const events: ExecutionEvent[] = [makeCloseResult(closeText)];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.screenshotPaths).toEqual(["/tmp/screenshot-0.png", "/tmp/screenshot-1.png"]);
    });
  });

  describe("extracting all artifacts together", () => {
    it("extracts video and screenshots from a complete close result", () => {
      const closeText = [
        "Browser closed.",
        "Playwright video: /tmp/replays/video.webm",
        "Screenshot: /tmp/screenshot-0.png",
      ].join("\n");
      const events: ExecutionEvent[] = [makeCloseResult(closeText)];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/replays/video.webm");
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/replays/video.webm").href);
      expect(artifacts.screenshotPaths).toEqual(["/tmp/screenshot-0.png"]);
    });

    it("handles partial artifacts — only video, no screenshots", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nPlaywright video: /tmp/video.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/video.webm");
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/video.webm").href);
      expect(artifacts.screenshotPaths).toEqual([]);
    });
  });

  describe("fed by the real ACP pipeline", () => {
    it("survives a tool_call_update that carries no title", () => {
      const plan = new TestPlan({
        id: PlanId.makeUnsafe("plan-01"),
        title: "artifacts",
        rationale: "artifacts",
        steps: [],
        changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
        currentBranch: "main",
        diffPreview: "",
        fileStats: [],
        instruction: "artifacts",
        baseUrl: Option.none(),
        isHeadless: true,
        cookieBrowserKeys: [],
        testCoverage: Option.none(),
      });

      const executed = new ExecutedTestPlan({ ...plan, events: [new RunStarted({ plan })] })
        .addEvent(
          new AcpToolCall({
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            title: CLOSE_TOOL_NAME,
            rawInput: {},
          }),
        )
        .addEvent(
          new AcpToolCallUpdate({
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
            // HACK: the adapter sends `rawOutput: chunk.content` — MCP content blocks, not text.
            rawOutput: [
              {
                type: "text",
                text: "Browser closed.\nPlaywright video: /tmp/v.webm\nScreenshot: /tmp/s0.png",
              },
            ],
          }),
        );

      const artifacts = extractCloseArtifacts(executed.events);

      expect(artifacts.videoPath).toBe("/tmp/v.webm");
      expect(artifacts.screenshotPaths).toEqual(["/tmp/s0.png"]);
    });
  });

  describe("uses the last close event", () => {
    it("picks the last successful close result when multiple exist", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Playwright video: /tmp/first-video.webm"),
        makeOtherToolResult("irrelevant"),
        makeCloseResult("Playwright video: /tmp/second-video.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/second-video.webm");
    });

    it("skips error close results and finds last successful one", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Playwright video: /tmp/good-video.webm"),
        makeErrorCloseResult("Playwright video: /tmp/error-video.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/good-video.webm");
    });
  });

  describe("edge cases", () => {
    it("returns undefined for whitespace-only paths", () => {
      const events: ExecutionEvent[] = [makeCloseResult("Playwright video:   ")];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
    });

    it("handles paths with spaces", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Playwright video: /tmp/my folder/video file.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/my folder/video file.webm");
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/my folder/video file.webm").href);
    });

    it("handles lines with extra whitespace and blank lines", () => {
      const closeText = "\n  Browser closed.  \n\n  Playwright video: /tmp/video.webm  \n\n";
      const events: ExecutionEvent[] = [makeCloseResult(closeText)];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/video.webm");
    });
  });
});
