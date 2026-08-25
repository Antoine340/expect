import type { ExecutionEvent } from "@expect/shared/models";
import { artifactLines, findCloseOutput, screenshotPathsFrom } from "@expect/shared/tool-events";
import { pathToFileURL } from "node:url";

const PLAYWRIGHT_VIDEO_PREFIX = "Playwright video:";

export interface CloseArtifacts {
  readonly videoUrl: string | undefined;
  readonly videoPath: string | undefined;
  readonly screenshotPaths: readonly string[];
}

export const extractCloseArtifacts = (events: readonly ExecutionEvent[]): CloseArtifacts => {
  const closeOutput = findCloseOutput(events);
  if (!closeOutput) {
    return {
      videoUrl: undefined,
      videoPath: undefined,
      screenshotPaths: [],
    };
  }

  const lines = artifactLines(closeOutput);
  const rawVideoPath = lines
    .find((line) => line.startsWith(PLAYWRIGHT_VIDEO_PREFIX))
    ?.replace(PLAYWRIGHT_VIDEO_PREFIX, "")
    .trim();
  const videoPath = rawVideoPath && rawVideoPath.length > 0 ? rawVideoPath : undefined;

  return {
    videoUrl: videoPath ? pathToFileURL(videoPath).href : undefined,
    videoPath,
    screenshotPaths: screenshotPathsFrom(lines),
  };
};
