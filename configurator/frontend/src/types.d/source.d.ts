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
  destinations: string[];
  sourceId: string;
  sourceType: string;
}
