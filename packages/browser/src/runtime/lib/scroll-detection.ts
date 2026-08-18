const SCROLL_OVERFLOW_THRESHOLD_PX = 10;
const MIN_SCROLLABLE_CHILDREN = 5;
const HIDDEN_MARKER_ATTR = "data-expect-scroll-hidden";
const PREV_VISIBILITY_ATTR = "data-expect-prev-visibility";
const MARKER_ELEMENT_ATTR = "data-expect-scroll-marker";
const MARKER_STYLE = "position:absolute;width:0;height:0;overflow:hidden;";

export interface ScrollContainerResult {
  totalChildren: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

// HACK: ariaSnapshot({ mode: "ai" }) reports aria-hidden subtrees, so hiding must be visual.
// visibility:hidden is excluded from the snapshot and, unlike display:none, reflows nothing —
// the boxes reported for the remaining elements stay accurate.
const hideChild = (child: Element, direction: "above" | "below"): boolean => {
  if (!(child instanceof HTMLElement) && !(child instanceof SVGElement)) return false;
  child.setAttribute(PREV_VISIBILITY_ATTR, child.style.visibility);
  child.style.visibility = "hidden";
  child.setAttribute(HIDDEN_MARKER_ATTR, direction);
  return true;
};

const insertMarker = (parent: Element, label: string, before: Element | null) => {
  const marker = document.createElement("div");
  marker.setAttribute("role", "note");
  marker.setAttribute("aria-label", label);
  marker.setAttribute(MARKER_ELEMENT_ATTR, "true");
  marker.style.cssText = MARKER_STYLE;
  if (before) {
    parent.insertBefore(marker, before);
  } else {
    parent.appendChild(marker);
  }
};

interface MeasuredContainer {
  element: Element;
  totalChildren: number;
  above: Element[];
  below: Element[];
  firstVisibleChild: Element | undefined;
  lastVisibleChild: Element | undefined;
}

// HACK: every measurement happens before any mutation. Interleaving them made each hidden
// child dirty the style tree, so the next getBoundingClientRect forced a fresh style and
// layout pass over the whole document. Splitting the phases is safe because neither writes
// affect layout: visibility:hidden reserves its box, and the marker is a zero-sized
// absolutely positioned node.
export const prepareViewportSnapshot = (): ScrollContainerResult[] => {
  const measured: MeasuredContainer[] = [];

  for (const element of document.querySelectorAll("*")) {
    if (element.scrollHeight <= element.clientHeight + SCROLL_OVERFLOW_THRESHOLD_PX) continue;

    const style = getComputedStyle(element);
    if (style.overflowY === "hidden" || style.overflowY === "visible") continue;

    const children = Array.from(element.children);
    if (children.length < MIN_SCROLLABLE_CHILDREN) continue;

    const containerRect = element.getBoundingClientRect();
    const above: Element[] = [];
    const below: Element[] = [];
    let firstVisibleChild: Element | undefined;
    let lastVisibleChild: Element | undefined;

    for (const child of children) {
      const childRect = child.getBoundingClientRect();
      if (childRect.bottom < containerRect.top) {
        above.push(child);
      } else if (childRect.top > containerRect.bottom) {
        below.push(child);
      } else {
        if (!firstVisibleChild) firstVisibleChild = child;
        lastVisibleChild = child;
      }
    }

    if (above.length === 0 && below.length === 0) continue;

    measured.push({
      element,
      totalChildren: children.length,
      above,
      below,
      firstVisibleChild,
      lastVisibleChild,
    });
  }

  const results: ScrollContainerResult[] = [];

  for (const container of measured) {
    let hiddenAbove = 0;
    let hiddenBelow = 0;

    for (const child of container.above) {
      if (hideChild(child, "above")) hiddenAbove++;
    }
    for (const child of container.below) {
      if (hideChild(child, "below")) hiddenBelow++;
    }

    if (hiddenAbove === 0 && hiddenBelow === 0) continue;

    if (hiddenAbove > 0 && container.firstVisibleChild) {
      insertMarker(
        container.element,
        `${hiddenAbove} items hidden above`,
        container.firstVisibleChild,
      );
    }
    if (hiddenBelow > 0 && container.lastVisibleChild) {
      insertMarker(
        container.element,
        `${hiddenBelow} items hidden below`,
        container.lastVisibleChild.nextSibling as Element | null,
      );
    }

    results.push({ totalChildren: container.totalChildren, hiddenAbove, hiddenBelow });
  }

  return results;
};

export const restoreViewportSnapshot = (): void => {
  for (const element of document.querySelectorAll(`[${HIDDEN_MARKER_ATTR}]`)) {
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      element.style.visibility = element.getAttribute(PREV_VISIBILITY_ATTR) ?? "";
    }
    element.removeAttribute(PREV_VISIBILITY_ATTR);
    element.removeAttribute(HIDDEN_MARKER_ATTR);
  }
  for (const marker of document.querySelectorAll(`[${MARKER_ELEMENT_ATTR}]`)) {
    marker.remove();
  }
};
