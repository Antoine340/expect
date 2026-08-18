import * as path from "node:path";

export const EXPECT_COOKIE_BROWSERS_ENV_NAME = "EXPECT_COOKIE_BROWSERS";
export const EXPECT_CDP_URL_ENV_NAME = "EXPECT_CDP_URL";
export const EXPECT_BASE_URL_ENV_NAME = "EXPECT_BASE_URL";
export const EXPECT_HEADED_ENV_NAME = "EXPECT_HEADED";
export const EXPECT_PROFILE_ENV_NAME = "EXPECT_PROFILE";
export const EXPECT_VIDEO_ENV_NAME = "EXPECT_VIDEO";
export const DUPLICATE_REQUEST_WINDOW_MS = 500;
export const PLAYWRIGHT_EVAL_TIMEOUT_MS = 120_000;
export const MAX_BUFFERED_CONSOLE_MESSAGES = 1_000;
export const MAX_BUFFERED_NETWORK_REQUESTS = 1_000;
export const TMP_ARTIFACT_OUTPUT_DIRECTORY = "/tmp/expect-artifacts";
export const CLI_SESSION_FILE = "/tmp/expect-cli-session.json";
export const MAX_DAEMON_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_STRINGIFY_LENGTH = 10_000;
export const RESULT_FILE_INDENT = 2;
export const SNAPSHOT_TREE_KEY = "tree";
export const PLAYWRIGHT_RESULTS_DIR = path.join(
  TMP_ARTIFACT_OUTPUT_DIRECTORY,
  "playwright-results",
);
