import type {
  ConnectorImageConfig,
  MiscEntity,
  DestinationConfig,
  FunctionConfig,
  ServiceConfig,
  StreamConfig,
  WorkspaceDomain,
  NotificationChannel,
  ModelConfig,
} from "../schema";

export type ConfigTypes = {
  model: ModelConfig;
  stream: StreamConfig;
  service: ServiceConfig;
  function: FunctionConfig;
  destination: DestinationConfig;
  "custom-image": ConnectorImageConfig;
  domain: WorkspaceDomain;
  misc: MiscEntity;
  notification: NotificationChannel;
};
export type ConfigType = keyof ConfigTypes;

// Exhaustive against ConfigTypes: adding a type without its loader is a compile error.
const configTypeNames = {
  model: true,
  stream: true,
  service: true,
  function: true,
  destination: true,
  "custom-image": true,
  domain: true,
  misc: true,
  notification: true,
} satisfies Record<ConfigType, true>;

export const allConfigTypes: readonly ConfigType[] = Object.keys(configTypeNames) as ConfigType[];
