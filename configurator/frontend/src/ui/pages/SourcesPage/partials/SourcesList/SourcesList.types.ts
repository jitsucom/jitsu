import { SourceConnector } from '../../../../../catalog/sources/types';

export interface SourcesListItemProps {
  sourceId: string;
  sourceProto: SourceConnector;
  handleDeleteSource: (sourceId: string) => void;
}
