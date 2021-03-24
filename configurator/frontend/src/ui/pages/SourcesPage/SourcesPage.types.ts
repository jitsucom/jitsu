export interface CommonSourcePageProps {
  sources: {
    [key: string]: SourceData;
  };
  projectId: string;
  setSources: any;
}
