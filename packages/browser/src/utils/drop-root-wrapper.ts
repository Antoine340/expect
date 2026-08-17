import { getIndentLevel } from "./get-indent-level";

const INDENT = "  ";
const ROOT_WRAPPER_REGEX = /^- generic(?: \[[^\]]*\])*:$/;

// HACK: ariaSnapshot({ mode: "ai" }) wraps the subtree in a `generic` node for the target
// element itself, which the default mode omits. Dropping it keeps depth semantics stable.
export const dropRootWrapper = (lines: readonly string[]): string[] => {
  const rootLines = lines.filter((line) => line.trim() && getIndentLevel(line) === 0);
  if (rootLines.length !== 1) return [...lines];
  if (!ROOT_WRAPPER_REGEX.test(rootLines[0].trim())) return [...lines];

  return lines
    .filter((line) => line !== rootLines[0])
    .map((line) => (line.startsWith(INDENT) ? line.slice(INDENT.length) : line));
};
