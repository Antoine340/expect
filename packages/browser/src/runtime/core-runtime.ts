// HACK: this barrel is an esbuild IIFE entry point for __EXPECT_RUNTIME__;
// build-runtime.js depends on a single file exporting the bundle's full API.
// It holds everything injected into every page, so it must stay free of the
// React overlay, which lives in overlay-runtime.ts and only ships headed.
export { getPerformanceMetrics, getPerformanceTrace } from "./lib/performance";
export type { PerformanceTrace } from "./lib/performance";

export {
  injectOverlayLabels,
  removeOverlay,
  findCursorInteractiveElements,
} from "./lib/annotation-overlay";
export type { CursorInteractiveResult } from "./lib/annotation-overlay";

export { prepareViewportSnapshot, restoreViewportSnapshot } from "./lib/scroll-detection";
export type { ScrollContainerResult } from "./lib/scroll-detection";

import { finder } from "@medv/finder";
export const cssSelector = finder;
