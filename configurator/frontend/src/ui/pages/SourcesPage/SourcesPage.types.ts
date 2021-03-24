import { Dispatch, SetStateAction } from 'react';

export interface CommonSourcePageProps {
  sources: {
    [key: string]: SourceData;
  };
  projectId: string;
  setSources: Dispatch<SetStateAction<{ [key: string]: SourceData }>>;
}
