import type { BoundingBox } from "../types";

export interface AriaLineAttributes {
  ref: string | undefined;
  box: BoundingBox | undefined;
  cursorPointer: boolean;
}

const REF_REGEX = /\[ref=([^\]]+)\]/;
const BOX_REGEX = /\[box=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\]/;
const CURSOR_POINTER = "[cursor=pointer]";

export const parseAriaAttributes = (line: string): AriaLineAttributes => {
  const boxMatch = BOX_REGEX.exec(line);

  return {
    ref: REF_REGEX.exec(line)?.[1],
    box: boxMatch
      ? {
          x: Number(boxMatch[1]),
          y: Number(boxMatch[2]),
          width: Number(boxMatch[3]),
          height: Number(boxMatch[4]),
        }
      : undefined,
    cursorPointer: line.includes(CURSOR_POINTER),
  };
};

const BOX_STRIP_REGEX = / \[box=[^\]]*\]/;
const REF_STRIP_REGEX = / \[ref=[^\]]+\]/;

export const stripAriaAttributes = (line: string, keepRef: boolean): string => {
  const withoutBox = line.replace(BOX_STRIP_REGEX, "");
  return keepRef ? withoutBox : withoutBox.replace(REF_STRIP_REGEX, "");
};
