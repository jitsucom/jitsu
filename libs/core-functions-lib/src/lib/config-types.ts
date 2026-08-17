export type ShortDestinationConfig = {
  id: string;
  connectionId: string;
  destinationType: string;
  name: string;
  credentials: any;
  options: any;
};

export type StreamWithDestinations = {
  stream: any;
  backupEnabled: boolean;
  destinations: ShortDestinationConfig[];
};

export type FunctionConfig = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  workspaceId: string;
  name: string;
  code: string;
  codeHash: string;
};

export type EnrichedConnectionConfig = {
  id: string;
  workspaceId: string;
  special?: string;
  updatedAt?: Date;
  destinationId: string;
  streamId: string;
  streamName?: string;
  metricsKeyPrefix: string;
  usesBulker: boolean;
  //destinationType
  type: string;
  options: any;
  optionsHash: string;

  credentials: {
    [key: string]: any;
  };
  credentialsHash: string;
};

export type WorkspaceWithProfiles = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  slug: string;
  featuresEnabled: string[];
  profileBuilders: ProfileBuilder[];
  // Live Events observability export (JITSU-138) is enabled for the workspace;
  // injected by the workspaces-with-profiles export from workspace settings
  otlpExportEnabled?: boolean;
};

export type ProfileBuilder = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  debugTill: Date;
  version: number;
  workspaceId: string;
  intermediateStorageCredentials: any;
  connectionOptions: any;
  destinationId: string;
  functions: FunctionConfig[];
};
