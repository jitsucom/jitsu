import { Dispatch, ReactNode, SetStateAction } from 'react';

export interface CollectionSourceData {
  sources: SourceData[];
  _lastUpdated?: string;
}

export interface CommonSourcePageProps {
  sources: SourceData[];
  setHeader: (header: ReactNode) => void;
  projectId: string;
  setSources: Dispatch<SetStateAction<CollectionSourceData>>;
}
