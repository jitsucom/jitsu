import { SourceConnector } from '@catalog/sources/types';

export interface SourcesListItemProps {
  sourceData: SourceData;
  sourceId: string;
  sourceProto: SourceConnector;
  handleDeleteSource: (sourceId: string) => void;
}
