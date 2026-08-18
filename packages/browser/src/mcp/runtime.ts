import { Layer, Logger, ManagedRuntime } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Analytics } from "@expect/shared/observability";
import { McpSession } from "./mcp-session";
import { OverlayController } from "./overlay-controller";
import { layerOnlyFileLogger } from "@expect/shared/observability";

export const McpRuntime = ManagedRuntime.make(
  Layer.mergeAll(McpSession.layer, OverlayController.layer).pipe(
    Layer.provideMerge(Analytics.layerLocal),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(layerOnlyFileLogger),
  ),
);
