/**
 * Shortened destination config for that is saved to store. It contains only information needed
 * to serve destination on the edge.
 *
 * See {@link DestinationConfig} for full destination config.
 */
export type ShortDestinationConfig = SyncShortDestinationConfig | AsyncShortDestinationConfig;

export type CommonShortDestinationConfig = {
  id: string;
  connectionId: string;
  destinationType: string;
  credentials: any;
  options: any;
};

export type SyncShortDestinationConfig = { isSynchronous: true } & CommonShortDestinationConfig;

export type AsyncShortDestinationConfig = { isSynchronous: false } & CommonShortDestinationConfig;

export type StreamWithDestinations = {
  stream: any;
  backupEnabled: boolean;
  synchronousDestinations: ShortDestinationConfig[];
  asynchronousDestinations: ShortDestinationConfig[];
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

export type Workspace = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  slug: string;
  featuresEnabled: string[];
  profileBuilders: ProfileBuilder[];
};

export type ProfileBuilder = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  debugTill: Date;
  version: number;
  workspaceId: string;
  intermediateStorageCredentials: any;
  destinationId: string;
  functions: [
    {
      functionId: string;
    }
  ];
};
