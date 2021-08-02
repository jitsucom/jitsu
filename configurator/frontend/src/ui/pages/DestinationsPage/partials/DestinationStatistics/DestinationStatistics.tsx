// @Libs
import useLoader from 'hooks/useLoader';
import { useServices } from 'hooks/useServices';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
// @Store
import { destinationsStore } from 'stores/destinations';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Components
import { PageHeader } from 'ui/components/PageHeader/PageHeader';
// @Types
import { CommonDestinationPageProps } from '../../DestinationsPage';
// @Routes
import { destinationPageRoutes } from '../../DestinationsPage.routes';

type StatisticsPageParams = {
  id: string;
};

export const DestinationStatistics: React.FC<CommonDestinationPageProps> = ({
  setBreadcrumbs
}) => {
  const services = useServices();
  const params = useParams<StatisticsPageParams>();
  const destinationReference = destinationsStore.getDestinationReferenceById(
    params.id
  );

  const [error, data, setData, reloadData, isLoading] = useLoader<unknown>(() =>
    services.backendApiClient.get(
      `/statistics?project_id=${services.activeProject.id}&start=${new Date(
        0
      ).toISOString()}&end=${new Date().toISOString()}&granularity=${'hour'}&status=$${'success'}&destination_id=$${
        params.id
      }`
    )
  );
  if (data) debugger;

  useEffect(() => {
    const breadcrumbs = [
      { title: 'Destinations', link: destinationPageRoutes.root },
      {
        title: (
          <PageHeader
            title={params.id}
            icon={destinationReference.ui.icon}
            mode="statistics"
          />
        )
      }
    ];
    setBreadcrumbs(withHome({ elements: breadcrumbs }));
  }, []);
  return null;
};
