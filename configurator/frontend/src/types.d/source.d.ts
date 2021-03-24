declare interface CollectionSource {
  name: string;
  type: string;
  parameters: Array<{
    [key: string]: string[];
  }>;
}

declare interface SourceData {
  collections: CollectionSource[];
  config: {
    [key: string]: string;
  };
  sourceId: string;
  sourceType: string;
}
