import * as path from "node:path";
import { DateTime, Option } from "effect";
import type { ExecutedTestPlan, TestPlanStep, ExecutionEvent } from "@expect/shared/models";
import {
  artifactLines,
  findCloseOutput,
  isToolNamed,
  screenshotPathsFrom,
} from "@expect/shared/tool-events";
import type { Status, StepResult, TestResult, TestEvent } from "./types";

const REPLAY_SESSION_PREFIX = "rrweb replay:";

const stepDurationMs = (step: TestPlanStep): number => {
  if (Option.isNone(step.startedAt)) return 0;
  if (Option.isNone(step.endedAt))
    return Date.now() - Number(DateTime.toEpochMillis(step.startedAt.value));
  return (
    Number(DateTime.toEpochMillis(step.endedAt.value)) -
    Number(DateTime.toEpochMillis(step.startedAt.value))
  );
};

const stepStatusToResultStatus = (status: string): Status => {
  if (status === "passed") return "passed";
  if (status === "failed" || status === "skipped") return "failed";
  return "pending";
};

export interface ExecutionArtifacts {
  readonly recordingPath: string | undefined;
  readonly screenshotPaths: readonly string[];
}

export const extractArtifacts = (events: readonly ExecutionEvent[]): ExecutionArtifacts => {
  const closeOutput = findCloseOutput(events);
  if (!closeOutput) {
    return { recordingPath: undefined, screenshotPaths: [] };
  }

  const lines = artifactLines(closeOutput);
  const replayLine = lines.find((line) => line.startsWith(REPLAY_SESSION_PREFIX));
  const recordingPath = replayLine?.replace(REPLAY_SESSION_PREFIX, "").trim() || undefined;

  return { recordingPath, screenshotPaths: screenshotPathsFrom(lines) };
};

export const buildStepResult = (
  step: TestPlanStep,
  screenshotPaths: readonly string[],
  stepIndex: number,
): StepResult => ({
  title: step.title,
  status: stepStatusToResultStatus(step.status),
  summary: Option.getOrElse(step.summary, () => ""),
  screenshotPath: screenshotPaths[stepIndex],
  duration: stepDurationMs(step),
});

export const buildTestResult = (
  executed: ExecutedTestPlan,
  url: string,
  startedAt: number,
  artifacts: ExecutionArtifacts,
): TestResult => {
  const steps = executed.steps.map((step, index) =>
    buildStepResult(step, artifacts.screenshotPaths, index),
  );
  const errors = steps.filter((step) => step.status === "failed");
  const hasFailure = errors.length > 0;
  const hasPending = steps.some((step) => step.status === "pending");

  let status: Status = "passed";
  if (hasFailure) status = "failed";
  else if (hasPending || steps.length === 0) status = "pending";

  return {
    status,
    url,
    duration: Date.now() - startedAt,
    recordingPath: artifacts.recordingPath,
    steps,
    errors,
  };
};

interface DiffContext {
  readonly stepMap: ReadonlyMap<string, TestPlanStep>;
  readonly stepIndexMap: ReadonlyMap<string, number>;
  readonly artifacts: ExecutionArtifacts;
  readonly executed: ExecutedTestPlan;
  readonly url: string;
  readonly startedAt: number;
}

const mapExecutionEvent = (event: ExecutionEvent, context: DiffContext): TestEvent | undefined => {
  switch (event._tag) {
    case "RunStarted":
      return {
        type: "run:started",
        title: event.plan.title,
        baseUrl: Option.getOrUndefined(event.plan.baseUrl),
      };
    case "StepStarted":
      return { type: "step:started", title: event.title };
    case "StepCompleted": {
      const step = context.stepMap.get(event.stepId);
      const index = context.stepIndexMap.get(event.stepId) ?? -1;
      return step
        ? {
            type: "step:passed",
            step: buildStepResult(step, context.artifacts.screenshotPaths, index),
          }
        : undefined;
    }
    case "StepFailed": {
      const step = context.stepMap.get(event.stepId);
      const index = context.stepIndexMap.get(event.stepId) ?? -1;
      return step
        ? {
            type: "step:failed",
            step: buildStepResult(step, context.artifacts.screenshotPaths, index),
          }
        : undefined;
    }
    case "StepSkipped":
      return {
        type: "step:skipped",
        title: context.stepMap.get(event.stepId)?.title ?? event.stepId,
        reason: event.reason,
      };
    case "ToolResult":
      // HACK: the screenshot tool returns image bytes, not a path — only the close output
      // carries real paths. Emit nothing rather than pass a serialized image off as one.
      return isToolNamed(event.toolName, "screenshot") &&
        !event.isError &&
        path.isAbsolute(event.result)
        ? { type: "screenshot", title: event.toolName, path: event.result }
        : undefined;
    case "RunFinished":
      return {
        type: "completed",
        result: buildTestResult(
          context.executed,
          context.url,
          context.startedAt,
          context.artifacts,
        ),
      };
    default:
      return undefined;
  }
};

export const diffEvents = (
  previous: readonly ExecutionEvent[],
  current: readonly ExecutionEvent[],
  executed: ExecutedTestPlan,
  url: string,
  startedAt: number,
): TestEvent[] => {
  const context: DiffContext = {
    stepMap: new Map(executed.steps.map((step) => [step.id, step])),
    stepIndexMap: new Map(executed.steps.map((step, index) => [step.id, index])),
    artifacts: extractArtifacts(executed.events),
    executed,
    url,
    startedAt,
  };

  return current
    .slice(previous.length)
    .map((event) => mapExecutionEvent(event, context))
    .filter((event): event is TestEvent => event !== undefined);
};
