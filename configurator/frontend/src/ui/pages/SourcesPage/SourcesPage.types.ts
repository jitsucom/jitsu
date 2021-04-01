import { Dispatch, SetStateAction } from 'react';

export interface CollectionSourceData {
  sources: SourceData[];
  _lastUpdated?: string;
}

export interface CommonSourcePageProps {
  sources: SourceData[];
  projectId: string;
  setSources: Dispatch<SetStateAction<CollectionSourceData>>;
}
