// @Libs
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
// @Types
import { DetailedStatisticsDatePoint } from 'lib/services/stat';

export const StatisticsChart = ({
  data,
  granularity
}: {
  data: DetailedStatisticsDatePoint[];
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
