import { PageProps } from '@./navigation';
import { useParams } from 'react-router-dom';
import useLoader from '@./lib/commons/useLoader';
import { DestinationConfig } from '@service/destinations';
import ApplicationServices from '@service/ApplicationServices';
import { useMemo } from 'react';
import { CenteredError, CenteredSpin } from '@./lib/components/components';

export const taskLogsPageRoute = '/sources/logs/:sourceId/:taskId?'

export const TaskLogsPage: React.FC<PageProps> = ({ setBreadcrumbs }) => {

  const params = useParams<{ sourceId: string, taskId: string }>();

  const [sourcesError, sources] = useLoader<any>(async() => {
    const appServices = ApplicationServices.get();
    const data = await appServices.storageService.get('sources', appServices.activeProject.id);
    const source: SourceData = data['sources'].find((source: SourceData) => source.sourceId === params.sourceId);
    return await appServices.backendApiClient.get(`/tasks?project_id=${appServices.activeProject.id}&source=${appServices.activeProject.id}_${source.sourceId}`, true);
  });

  if (sourcesError) {
    return <CenteredError error={sourcesError} />
  } else if (!sources) {
    return <CenteredSpin />
  }

  const sourceData = sources.find((source: SourceData) => source.sourceId === params.sourceId);

  return <pre>{JSON.stringify(sourceData, null, 2)}</pre>

}

