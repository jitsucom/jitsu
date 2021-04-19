import { Dispatch, ReactNode, SetStateAction } from 'react';
import { BreadcrumbsProps } from '@molecule/Breadcrumbs/Breadcrumbs.types';

export interface CollectionSourceData {
  sources: SourceData[];
  _lastUpdated?: string;
}

export interface CommonSourcePageProps {
  sources: SourceData[];
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void;
  projectId: string;
  setSources: Dispatch<SetStateAction<CollectionSourceData>>;
}
