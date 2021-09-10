// @Libs
import { Button, Card, Col, Row } from 'antd';
import { useEffect, useMemo } from 'react';
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
import { useServices } from 'hooks/useServices';
import {
  DestinationsStatisticsDatePoint,
  DetailedStatisticsDatePoint,
  IStatisticsService,
  StatisticsService
} from 'lib/services/stat';
// @Utils
import useLoader, { useLoaderAsObject } from 'hooks/useLoader';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Styles
import styles from './DestinationStatistics.module.less';
import { Destination } from '../../../../../catalog/destinations/types';

type StatisticsPageParams = {
  id: string;
};

function monthlyDataLoader(destinationUid: string, destination: Destination, type: 'source' | 'push_source', statisticsService: IStatisticsService) {
  if (destination.syncFromSourcesStatus !== 'supported' && type === 'source') {
    return async() => [];
  }
  return async() => {
    const now = new Date();
    const yesterday = new Date(+now - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(+now - 30 * 24 * 60 * 60 * 1000);
    return destination
      ?
      (await statisticsService.getDetailedStatisticsByDestinations(
        monthAgo,
        yesterday,
        'day',
        type,
        destinationUid
      )) || []
      :
      [];
  };
}

function hourlyDataLoader(destinationUid: string, destination: Destination, type: 'source' | 'push_source', statisticsService: IStatisticsService) {
  if (destination.syncFromSourcesStatus !== 'supported' && type === 'source') {
    return async() => [];
  }
  return async() => {
    const now = new Date();
    const previousHour = new Date(+now - 60 * 60 * 1000);
    const dayAgo = new Date(+now - 24 * 60 * 60 * 1000);
    return destinationUid
      ?
      (await statisticsService.getDetailedStatisticsByDestinations(
        dayAgo,
        previousHour,
        'hour',
        type,
        destinationUid
      )) || []
      :
      [];
  };
}

export const DestinationStatistics: React.FC<CommonDestinationPageProps> = ({
  setBreadcrumbs
}) => {
  const history = useHistory();
  const services = useServices();
  const params = useParams<StatisticsPageParams>();
  const destination = destinationsStore.getDestinationById(params.id);
  const destinationUid = destination?._uid;
  const destinationReference = destinationsStore.getDestinationReferenceById(
    params.id
  );
  const statisticsService = useMemo<IStatisticsService>(
    () =>
      new StatisticsService(
        services.backendApiClient,
        services.activeProject,
        true
      ),
    []
  );

  // Events last 30 days
  const monthlyPushEvents = useLoaderAsObject<DestinationsStatisticsDatePoint[]>(
    monthlyDataLoader(destinationUid,  destinationReference, 'push_source', statisticsService), [destinationUid]
  );
  const monthlyPullEvents = useLoaderAsObject<DestinationsStatisticsDatePoint[]>(
    monthlyDataLoader(destinationUid, destinationReference, 'source', statisticsService), [destinationUid]
  );

  // Last 24 hours
  const dailyPushEvents = useLoaderAsObject<DetailedStatisticsDatePoint[]>(
    hourlyDataLoader(destinationUid, destinationReference, 'push_source',  statisticsService), [destinationUid]
  );

  // Last 24 hours
  const dailyPullEvents = useLoaderAsObject<DetailedStatisticsDatePoint[]>(
    hourlyDataLoader(destinationUid, destinationReference, 'source', statisticsService), [destinationUid]
  );

  const somethingIsLoading = monthlyPushEvents.isLoading || monthlyPullEvents.isLoading || dailyPushEvents.isLoading || dailyPullEvents.isLoading;

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
    <>
      <div className="flex flex-row space-x-2 justify-end mb-4">
        <Button
          type="ghost"
          icon={<EditOutlined />}
          size="large"
          onClick={() =>
            history.push(
              generatePath(destinationPageRoutes.editExact, {
                id: params.id
              })
            )
          }
        >
          {'Edit Destination'}
        </Button>
        <Button
          type="ghost"
          icon={<UnorderedListOutlined />}
          size="large"
          onClick={() => history.push(destinationPageRoutes.root)}
        >
          {'Destinations List'}
        </Button>
      </div>
      <Row gutter={16}>
        <Col span={12}>
          <Card
            title="Incoming events (last 30 days)"
            bordered={false}
            className="w-full"
            loading={somethingIsLoading}
          >
            <StatisticsChart data={monthlyPushEvents.data || []} granularity={'day'} />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title="Incoming events (last 24 hours)"
            bordered={false}
            className="w-full"
            loading={somethingIsLoading}
          >
            <StatisticsChart data={monthlyPushEvents.data || []} granularity={'hour'} />
          </Card>
        </Col>
      </Row>
      {destinationReference.syncFromSourcesStatus === 'supported' && <Row gutter={16}>
        <Col span={12}>
          <Card
            title="Rows synchronized from sources (last 30 days)"
            bordered={false}
            className="w-full"
            loading={somethingIsLoading}
          >
            <StatisticsChart data={monthlyPullEvents.data || []} granularity={'day'} />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title="Rows synchronized from sources (last 24 hours)"
            bordered={false}
            className="w-full"
            loading={somethingIsLoading}
          >
            <StatisticsChart data={monthlyPullEvents.data || []} granularity={'hour'} />
          </Card>
        </Col>
      </Row>}

    </>) : (
    <DestinationNotFound destinationId={params.id} />
  );
};
