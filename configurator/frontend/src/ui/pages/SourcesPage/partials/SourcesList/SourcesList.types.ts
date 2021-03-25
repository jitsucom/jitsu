import { SourceConnector } from '@connectors/types';

export interface SourcesListItemProps {
  sourceId: string;
  sourceProto: SourceConnector;
  handleDeleteSource: (sourceId: string) => void;
}
