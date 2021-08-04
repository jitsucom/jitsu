// @Libs
import { Button, Card } from 'antd';
import { useEffect } from 'react';
import { generatePath, useHistory, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
// @Store
import { destinationsStore } from 'stores/destinations';
// @Components
import { PageHeader } from 'ui/components/PageHeader/PageHeader';
import { DestinationNotFound } from '../DestinationNotFound/DestinationNotFound';
// @Routes
import { destinationPageRoutes } from '../../DestinationsPage.routes';
// @Types
import { CommonDestinationPageProps } from '../../DestinationsPage';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
import {
  DestinationStatisticsDatePoint,
  StatisticsService
} from 'lib/services/stat';
// @Utils
import useLoader from 'hooks/useLoader';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Styles
import styles from './DestinationStatistics.module.less';
import { ArrowLeftOutlined } from '@ant-design/icons';

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
    DestinationStatisticsDatePoint[]
  >(async () => {
    const now = new Date();
    const yesterday = new Date(+now - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(+now - 30 * 24 * 60 * 60 * 1000);
    return destinationUid
      ? (await statisticsService.getDestinationStatistics(
          monthAgo,
          yesterday,
          'day',
          destinationUid
        )) || []
      : [];
  }, [destinationUid]);

  // Last 24 hours
  const [, dayData, , , isDayDataLoading] = useLoader<
    DestinationStatisticsDatePoint[]
  >(async () => {
    const now = new Date();
    const previousHour = new Date(+now - 60 * 60 * 1000);
    const dayAgo = new Date(+now - 24 * 60 * 60 * 1000);
    return destinationUid
      ? (await statisticsService.getDestinationStatistics(
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
          <Chart data={monthData || []} granularity={'day'} />
        </Card>
        <Card
          title="Events last 24 hours"
          bordered={false}
          className="flex-auto w-full"
          loading={isDayDataLoading || isMonthDataLoading}
        >
          <Chart data={dayData || []} granularity={'hour'} />
        </Card>
      </div>
      <Button
        type="primary"
        className="mt-4"
        size="large"
        onClick={() =>
          history.push(
            generatePath(destinationPageRoutes.editExact, {
              id: params.id
            })
          )
        }
      >
        {'Edit Destination Settings'}
      </Button>
      <Button
        type="ghost"
        icon={<ArrowLeftOutlined />}
        className="mt-4"
        onClick={() => history.push(destinationPageRoutes.root)}
        size="large"
      >
        {'Back to Destinations List'}
      </Button>
    </div>
  ) : (
    <DestinationNotFound destinationId={params.id} />
  );
};

const CustomizedXAxisTick = (props) => (
  <g transform={`translate(${props.x},${props.y})`}>
    <text x={0} y={0} dy={16} fontSize="10" textAnchor="end" fill="white">
      {props.payload.value}
    </text>
  </g>
);

const CustomizedYAxisTick = (props) => (
  <g transform={`translate(${props.x},${props.y})`}>
    <text x={0} y={0} fontSize="10" textAnchor="end" fill="white">
      {new Intl.NumberFormat('en').format(props.payload.value)}
    </text>
  </g>
);

const Chart = ({
  data,
  granularity
}: {
  data: DestinationStatisticsDatePoint[];
  granularity: 'hour' | 'day';
}) => (
  <ResponsiveContainer width="100%" minHeight={300} minWidth={300}>
    <LineChart
      data={data.map((point) => ({
        ...point,
        date:
          granularity == 'hour'
            ? point.date.format('HH:mm')
            : point.date.format('DD MMM')
      }))}
    >
      <XAxis dataKey="date" tick={<CustomizedXAxisTick />} stroke="#394e5a" />
      <YAxis tick={<CustomizedYAxisTick />} stroke="#394e5a" />
      <CartesianGrid strokeDasharray="3 3" stroke="#394e5a" />
      <Legend />
      <Tooltip
        wrapperStyle={{
          backgroundColor: '#22313a',
          border: '1px solid #394e5a'
        }}
        itemStyle={{ color: '#9bbcd1' }}
        labelStyle={{ color: '#dcf3ff' }}
        formatter={(value) => new Intl.NumberFormat('en').format(value)}
      />
      <Line
        type="monotone"
        dataKey="success"
        stroke={'#2cc56f'}
        // opacity={0.9}
        activeDot={{ r: 8 }}
        strokeWidth={2}
      />
      <Line
        type="monotone"
        dataKey="skip"
        stroke={'#ffc021'}
        // opacity={0.9}
        activeDot={{ r: 8 }}
        strokeWidth={2}
      />
      <Line
        type="monotone"
        dataKey="errors"
        stroke={'#e53935'}
        // opacity={0.9}
        activeDot={{ r: 8 }}
        strokeWidth={2}
      />
    </LineChart>
  </ResponsiveContainer>
);
