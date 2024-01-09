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

  credentials: {
    [key: string]: any;
  };
  credentialsHash: string;
};

