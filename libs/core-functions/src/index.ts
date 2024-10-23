import {
  BuiltinDestinationFunctionName,
  BuiltinFunctionName,
  BuiltinTransformationFunctionName,
  FuncReturn,
  JitsuFunction,
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
import BrazeDestination from "./functions/braze-destination";

const builtinDestinations: Record<BuiltinDestinationFunctionName, JitsuFunction> = {
  "builtin.destination.bulker": BulkerDestination as JitsuFunction,
  "builtin.destination.mixpanel": MixpanelDestination as JitsuFunction,
  "builtin.destination.intercom": IntercomDestination as JitsuFunction,
  "builtin.destination.segment-proxy": SegmentDestination as JitsuFunction,
  "builtin.destination.june": JuneDestination as JitsuFunction,
  "builtin.destination.braze": BrazeDestination as JitsuFunction,
  "builtin.destination.ga4": Ga4Destination as JitsuFunction,
  "builtin.destination.webhook": WebhookDestination as JitsuFunction,
  "builtin.destination.posthog": PosthogDestination as JitsuFunction,
  "builtin.destination.mongodb": MongodbDestination as JitsuFunction,
  "builtin.destination.amplitude": AmplitudeDestination as JitsuFunction,
  "builtin.destination.facebook-conversions": FacebookConversionsApi as JitsuFunction,
  "builtin.destination.hubspot": HubspotDestination as JitsuFunction,
  "builtin.destination.devnull": () => null,
  "builtin.destination.tag": () => undefined,
  "builtin.destination.gtm": () => undefined,
  "builtin.destination.logrocket": () => undefined,
  "builtin.destination.ga4-tag": () => undefined,
} as const;

const builtinTransformations: Record<BuiltinTransformationFunctionName, JitsuFunction> = {
  "builtin.transformation.user-recognition": UserRecognitionFunction as JitsuFunction,
} as const;

const builtinFunctions: Record<BuiltinFunctionName, JitsuFunction> = {
  ...builtinDestinations,
  ...builtinTransformations,
} as const;

export function getBuiltinFunction(id: string): JitsuFunction | undefined {
  const fixedId = id.indexOf("builtin.") === 0 ? id : `builtin.${id}`;
  return builtinFunctions[fixedId];
}

export function isDropResult(result: FuncReturn): boolean {
  return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

export * as bulkerDestination from "./functions/bulker-destination";
export { UDFWrapper, UDFTestRun } from "./functions/lib/udf_wrapper";
export type { UDFTestRequest, UDFTestResponse, logType } from "./functions/lib/udf_wrapper";
export { ProfileUDFWrapper, ProfileUDFTestRun, mergeUserTraits } from "./functions/lib/profiles-udf-wrapper";
export type {
  ProfileUDFTestRequest,
  ProfileUDFTestResponse,
  ProfileUser,
  ProfileFunctionWrapper,
} from "./functions/lib/profiles-udf-wrapper";
export { makeLog, makeFetch, MultiEventsStore, DummyEventsStore, wrapperFunction } from "./functions/lib/index";
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
  EventsStore,
  JitsuFunctionWrapper,
} from "./functions/lib/index";
export { httpAgent, httpsAgent } from "./functions/lib/http-agent";
export * from "./functions/lib/store";
export * from "./functions/lib/ua";
export * from "./functions/lib/clickhouse-logger";
export * from "./functions/profiles-functions";
export * from "./functions/lib/crypto-code";
export * from "./lib/inmem-store";
export * from "./lib/config-types";
export * from "./lib/entity-store";
