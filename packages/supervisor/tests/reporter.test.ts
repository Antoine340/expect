import { Effect, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  ChangesFor,
  ExecutedTestPlan,
  PlanId,
  RunStarted,
  TestPlan,
  ToolResult,
} from "@expect/shared/models";
import { Reporter } from "../src/reporter";

const makePlan = () =>
  new TestPlan({
    id: PlanId.makeUnsafe("plan-01"),
    title: "report",
    rationale: "report",
    steps: [],
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "main",
    diffPreview: "",
    fileStats: [],
    instruction: "report",
    baseUrl: Option.none(),
    isHeadless: true,
    cookieBrowserKeys: [],
    testCoverage: Option.none(),
  });

const executedWith = (events: readonly ToolResult[]) => {
  const plan = makePlan();
  return new ExecutedTestPlan({ ...plan, events: [new RunStarted({ plan }), ...events] });
};

const runReport = (executed: ExecutedTestPlan) =>
  Effect.gen(function* () {
    const reporter = yield* Reporter;
    return yield* reporter.report(executed);
  }).pipe(Effect.provide(Reporter.layer), Effect.runPromise);

describe("Reporter", () => {
  it("takes screenshot paths from the close output", async () => {
    const report = await runReport(
      executedWith([
        new ToolResult({
          toolCallId: "call-close",
          toolName: "mcp__browser__close",
          result: "Browser closed.\nScreenshot: /tmp/s0.png\nScreenshot: /tmp/s1.png",
          isError: false,
        }),
      ]),
    );

    expect(report.screenshotPaths).toEqual(["/tmp/s0.png", "/tmp/s1.png"]);
  });

  it("never reports a screenshot tool result as a path", async () => {
    const report = await runReport(
      executedWith([
        new ToolResult({
          toolCallId: "call-screenshot",
          toolName: "mcp__browser__screenshot",
          result: '{"type":"image","data":"iVBORw0KGgo","mimeType":"image/png"}',
          isError: false,
        }),
      ]),
    );

    expect(report.screenshotPaths).toEqual([]);
  });
});
