import {
  BuiltinDestinationFunctionName,
  BuiltinFunctionName,
  BuiltinTransformationFunctionName,
  FuncReturn,
} from "@jitsu/protocols/functions";
import BulkerDestination from "./functions/bulker-destination";
import MixpanelDestination from "./functions/mixpanel-destination";
import Ga4Destination from "./functions/ga4-destination";
import WebhookDestination from "./functions/webhook-destination";
import PosthogDestination from "./functions/posthog-destination";
import UserRecognitionFunction from "./functions/user-recognition";
import MongodbDestination from "./functions/mongodb-destination";
import JuneDestination from "./functions/june-destination";
import SegmentDestination from "./functions/segment-destination";
import AmplitudeDestination from "./functions/amplitude-destination";
import FacebookConversionsApi from "./functions/facebook-conversions";
import IntercomDestination from "./functions/intercom-destination";
import HubspotDestination from "./functions/hubspot-destination";
import { FunctionChainContext, FunctionContext, JitsuFunctionWrapper } from "./functions/lib";

const devNull = (chainCtx: FunctionChainContext, funcCtx: FunctionContext<any>) => () => null;
const placeHolder = (chainCtx: FunctionChainContext, funcCtx: FunctionContext<any>) => () => undefined;

const builtinDestinations: Record<BuiltinDestinationFunctionName, JitsuFunctionWrapper> = {
  "builtin.destination.bulker": BulkerDestination as JitsuFunctionWrapper,
  "builtin.destination.mixpanel": MixpanelDestination as JitsuFunctionWrapper,
  "builtin.destination.intercom": IntercomDestination as JitsuFunctionWrapper,
  "builtin.destination.segment-proxy": SegmentDestination as JitsuFunctionWrapper,
  "builtin.destination.june": JuneDestination as JitsuFunctionWrapper,
  "builtin.destination.ga4": Ga4Destination as JitsuFunctionWrapper,
  "builtin.destination.webhook": WebhookDestination as JitsuFunctionWrapper,
  "builtin.destination.posthog": PosthogDestination as JitsuFunctionWrapper,
  "builtin.destination.mongodb": MongodbDestination as JitsuFunctionWrapper,
  "builtin.destination.amplitude": AmplitudeDestination as JitsuFunctionWrapper,
  "builtin.destination.facebook-conversions": FacebookConversionsApi as JitsuFunctionWrapper,
  "builtin.destination.hubspot": HubspotDestination as JitsuFunctionWrapper,
  "builtin.destination.devnull": devNull,
  "builtin.destination.tag": placeHolder,
  "builtin.destination.gtm": placeHolder,
  "builtin.destination.logrocket": placeHolder,
  "builtin.destination.ga4-tag": placeHolder,
} as const;

const builtinTransformations: Record<BuiltinTransformationFunctionName, JitsuFunctionWrapper> = {
  "builtin.transformation.user-recognition": UserRecognitionFunction as JitsuFunctionWrapper,
} as const;

const builtinFunctions: Record<BuiltinFunctionName, JitsuFunctionWrapper> = {
  ...builtinDestinations,
  ...builtinTransformations,
} as const;

export function getBuiltinFunction(id: string): JitsuFunctionWrapper | undefined {
  const fixedId = id.indexOf("builtin.") === 0 ? id : `builtin.${id}`;
  return builtinFunctions[fixedId];
}

export function isDropResult(result: FuncReturn): boolean {
  return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

export * as bulkerDestination from "./functions/bulker-destination";
export { UDFWrapper, UDFTestRun } from "./functions/udf_wrapper";
export type { UDFTestRequest, UDFTestResponse, logType } from "./functions/udf_wrapper";
export { makeLog, makeFetch, MultiEventsStore, DummyEventsStore } from "./functions/lib/index";
export * as mixpanelDestination from "./functions/mixpanel-destination";
export * as ga4Destination from "./functions/ga4-destination";
export * as webhookDestination from "./functions/webhook-destination";
export * as posthogDestination from "./functions/posthog-destination";
export * as mongodbDestination from "./functions/mongodb-destination";
export { mongodb, mongoAnonymousEventsStore } from "./functions/lib/mongodb";
export type {
  MetricsMeta,
  FunctionContext,
  FunctionChainContext,
  FetchType,
  FetchOpts,
  FetchResponse,
  EventsStore,
} from "./functions/lib/index";
export { httpAgent, httpsAgent } from "./functions/lib/http-agent";
export * from "./functions/lib/store";
export * from "./functions/lib/ua";
