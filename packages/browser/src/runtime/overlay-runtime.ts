// HACK: second esbuild IIFE entry point, injected only in headed mode because it pulls in
// React, react-dom and the overlay stylesheet with its inlined font. It merges into the
// __EXPECT_RUNTIME__ object that core-runtime.ts installs, so it must be injected after it.
export {
  initAgentOverlay,
  updateCursor,
  hideAgentOverlay,
  showAgentOverlay,
  destroyAgentOverlay,
  highlightRefs,
  clearHighlights,
  logAction,
} from "./overlay";
