import { Effect, Layer, Option, ServiceMap } from "effect";
import { type ExecutedTestPlan, TestReport } from "@expect/shared/models";
import { artifactLines, findCloseOutput, screenshotPathsFrom } from "@expect/shared/tool-events";

export class Reporter extends ServiceMap.Service<Reporter>()("@supervisor/Reporter", {
  make: Effect.gen(function* () {
    const report = Effect.fn("Reporter.report")(function* (executed: ExecutedTestPlan) {
      const failedSteps = executed.events.filter((event) => event._tag === "StepFailed");
      const completedSteps = executed.events.filter((event) => event._tag === "StepCompleted");
      const runFinished = executed.events.find((event) => event._tag === "RunFinished");

      const summary = runFinished
        ? runFinished.summary
        : failedSteps.length > 0
          ? `${failedSteps.length} step${failedSteps.length === 1 ? "" : "s"} failed, ${completedSteps.length} passed`
          : `${completedSteps.length} step${completedSteps.length === 1 ? "" : "s"} completed`;

      const closeOutput = findCloseOutput(executed.events);
      const screenshotPaths = closeOutput ? screenshotPathsFrom(artifactLines(closeOutput)) : [];

      const report = new TestReport({
        ...executed,
        summary,
        screenshotPaths,
        pullRequest: Option.none(),
        testCoverageReport: executed.testCoverage,
      });

      yield* Effect.logInfo("Report generated", {
        status: report.status,
        stepCount: executed.steps.length,
        passedCount: completedSteps.length,
        failedCount: failedSteps.length,
        screenshotCount: screenshotPaths.length,
      });

      return report;
    });

    return { report } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make);
}
