// @Libs
import { Button, Card } from 'antd';
import { useEffect } from 'react';
import { generatePath, useHistory, useParams } from 'react-router-dom';
// @Store
import { destinationsStore } from 'stores/destinations';
// @Components
import { StatisticsChart } from 'ui/components/StatisticsChart/StatisticsChart';
import { PageHeader } from 'ui/components/PageHeader/PageHeader';
import { DestinationNotFound } from '../DestinationNotFound/DestinationNotFound';
// @Icons
import { EditOutlined, UnorderedListOutlined } from '@ant-design/icons';
// @Routes
import { destinationPageRoutes } from '../../DestinationsPage.routes';
// @Types
import { CommonDestinationPageProps } from '../../DestinationsPage';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
import {
  DetailedStatisticsDatePoint,
  StatisticsService
} from 'lib/services/stat';
// @Utils
import useLoader from 'hooks/useLoader';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Styles
import styles from './DestinationStatistics.module.less';

type StatisticsPageParams = {
  id: string;
};

const services = ApplicationServices.get();
const statisticsService = new StatisticsService(
  services.backendApiClient,
  services.activeProject,
  true
);

export const DestinationStatistics: React.FC<CommonDestinationPageProps> = ({
  setBreadcrumbs
}) => {
  const history = useHistory();
  const params = useParams<StatisticsPageParams>();
  const destinationUid = destinationsStore.getDestinationById(params.id)?._uid;
  const destinationReference = destinationsStore.getDestinationReferenceById(
    params.id
  );

  // Events last 30 days
  const [, monthData, , , isMonthDataLoading] = useLoader<
    DetailedStatisticsDatePoint[]
  >(async () => {
    const now = new Date();
    const yesterday = new Date(+now - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(+now - 30 * 24 * 60 * 60 * 1000);
    return destinationUid
      ? (await statisticsService.getDetailedStatistics(
          monthAgo,
          yesterday,
          'day',
          destinationUid
        )) || []
      : [];
  }, [destinationUid]);

  // Last 24 hours
  const [, dayData, , , isDayDataLoading] = useLoader<
    DetailedStatisticsDatePoint[]
  >(async () => {
    const now = new Date();
    const previousHour = new Date(+now - 60 * 60 * 1000);
    const dayAgo = new Date(+now - 24 * 60 * 60 * 1000);
    return destinationUid
      ? (await statisticsService.getDetailedStatistics(
          dayAgo,
          previousHour,
          'hour',
          destinationUid
        )) || []
      : [];
  }, [destinationUid]);

  useEffect(() => {
    const breadcrumbs = [
      { title: 'Destinations', link: destinationPageRoutes.root },
      {
        title: (
          <PageHeader
            title={destinationReference ? params.id : 'Destination Not Found'}
            icon={destinationReference?.ui.icon}
            mode={destinationReference ? 'statistics' : null}
          />
        )
      }
    ];
    setBreadcrumbs(withHome({ elements: breadcrumbs }));
  }, []);
  return destinationReference ? (
    <div className="flex flex-col items-center w-full h-full">
      <div className={`self-stretch flex items-start ${styles.container}`}>
        <Card
          title="Events last 30 days"
          bordered={false}
          className="flex-auto w-full"
          loading={isMonthDataLoading || isDayDataLoading}
        >
          <StatisticsChart data={monthData || []} granularity={'day'} />
        </Card>
        <Card
          title="Events last 24 hours"
          bordered={false}
          className="flex-auto w-full"
          loading={isDayDataLoading || isMonthDataLoading}
        >
          <StatisticsChart data={dayData || []} granularity={'hour'} />
        </Card>
      </div>
      <Button
        type="primary"
        icon={<EditOutlined />}
        size="large"
        className="mt-4"
        onClick={() =>
          history.push(
            generatePath(destinationPageRoutes.editExact, {
              id: params.id
            })
          )
        }
      >
        {'Destination Settings'}
      </Button>
      <Button
        type="ghost"
        icon={<UnorderedListOutlined />}
        size="large"
        className="mt-4"
        onClick={() => history.push(destinationPageRoutes.root)}
      >
        {'Destinations List'}
      </Button>
    </div>
  ) : (
    <DestinationNotFound destinationId={params.id} />
  );
};
