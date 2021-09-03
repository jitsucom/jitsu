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
import useLoader from 'hooks/useLoader';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Styles
import styles from './DestinationStatistics.module.less';

type StatisticsPageParams = {
  id: string;
};

export const DestinationStatistics: React.FC<CommonDestinationPageProps> = ({
  setBreadcrumbs
}) => {
  const history = useHistory();
  const services = useServices();
  const params = useParams<StatisticsPageParams>();
  const destinationUid = destinationsStore.getDestinationById(params.id)?._uid;
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
  const [, monthData, , , isMonthDataLoading] = useLoader<
    DestinationsStatisticsDatePoint[]
  >(async () => {
    const now = new Date();
    const yesterday = new Date(+now - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(+now - 30 * 24 * 60 * 60 * 1000);
    return destinationUid
      ? (await statisticsService.getDetailedStatisticsByDestinations(
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
      ? (await statisticsService.getDetailedStatisticsByDestinations(
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
    <Row gutter={16}>
      <Col span={24} lg={16} xl={18}>
        <Row className="mb-4">
          <Card
            title="Events last 30 days"
            bordered={false}
            className="w-full"
            loading={isMonthDataLoading || isDayDataLoading}
          >
            <StatisticsChart data={monthData || []} granularity={'day'} />
          </Card>
        </Row>
        <Row>
          <Card
            title="Events last 24 hours"
            bordered={false}
            className="w-full"
            loading={isDayDataLoading || isMonthDataLoading}
          >
            <StatisticsChart data={dayData || []} granularity={'hour'} />
          </Card>
        </Row>
      </Col>
      <Col span={24} lg={8} xl={6}>
        <Card bordered={false} className="flex flex-col items-stretch h-full">
          <Button
            type="ghost"
            icon={<EditOutlined />}
            size="large"
            className="w-full"
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
            className="w-full mt-2"
            onClick={() => history.push(destinationPageRoutes.root)}
          >
            {'Destinations List'}
          </Button>
        </Card>
      </Col>
    </Row>
  ) : (
    <DestinationNotFound destinationId={params.id} />
  );
};
