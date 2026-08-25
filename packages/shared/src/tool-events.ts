import type { ExecutionEvent } from "./models";

const MCP_TOOL_NAME_SEPARATOR = "__";
const SCREENSHOT_PREFIX = "Screenshot:";

export const isToolNamed = (toolName: string, tool: string) =>
  toolName === tool || toolName.endsWith(`${MCP_TOOL_NAME_SEPARATOR}${tool}`);

export const findCloseOutput = (events: readonly ExecutionEvent[]) => {
  const closeResult = events.findLast(
    (event) =>
      event._tag === "ToolResult" &&
      isToolNamed(event.toolName, "close") &&
      !event.isError &&
      event.result.length > 0,
  );
  return closeResult?._tag === "ToolResult" ? closeResult.result : undefined;
};

export const artifactLines = (closeOutput: string) =>
  closeOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export const screenshotPathsFrom = (lines: readonly string[]) =>
  lines
    .filter((line) => line.startsWith(SCREENSHOT_PREFIX))
    .map((line) => line.replace(SCREENSHOT_PREFIX, "").trim())
    .filter((value) => value.length > 0);
