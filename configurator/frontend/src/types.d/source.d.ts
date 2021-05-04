declare interface CollectionSource {
  name: string;
  type: string;
  parameters: Array<{
    [key: string]: string[];
  }>;
  schedule: string;
}

declare interface SourceData {
  collections: CollectionSource[];
  config: {
    [key: string]: string;
  };
  schedule?: string;
  destinations: string[];
  sourceId: string;
  sourceType: string;
  sourceProtoType: string;
  connected: boolean;
  connectedErrorMessage?: string;
}
