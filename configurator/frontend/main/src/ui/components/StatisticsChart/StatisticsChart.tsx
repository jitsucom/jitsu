// @Libs
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useReducer } from "react"
// @Types
import { Moment } from "moment"
// @Styles
import styles from "./StatisticsChart.module.less"

type DataType = "total" | "success" | "skip" | "errors"

type DataPoint = { date: Moment } & { [key in DataType]?: number }

type Props = {
  data: DataPoint[]
  granularity: "hour" | "day"
  dataToDisplay?: DataType | DataType[]
  legendLabels?: { [key: string]: string }
}

type State = {
  [key in `hide_${DataType}_data`]: boolean
}

const initialState: State = {
  hide_total_data: false,
  hide_errors_data: false,
  hide_skip_data: false,
  hide_success_data: false,
}

const reducer = (state: State, action: { type: DataType }): State => {
  const key = `hide_${action.type}_data`
  return {
    ...state,
    [key]: !state[key],
  }
}

const commonLineProps = {
  type: "monotone",
  // opacity: 0.9,
  cursor: "pointer",
  activeDot: { r: 8 },
  strokeWidth: 2,
} as const

export const StatisticsChart: React.FC<Props> = ({
  data,
  granularity,
  dataToDisplay = ["success", "skip", "errors"],
  legendLabels = {},
}) => {
  const [state, dispatch] = useReducer(reducer, initialState)

  const handleClickOnLegend = (data: any) => {
    const clickedDataType = data["value"] as DataType
    dispatch({ type: clickedDataType })
  }

  return (
    <ResponsiveContainer width="100%" minHeight={225} minWidth={300}>
      <LineChart
        className={styles.chart}
        data={data.map(point => ({
          ...point,
          date: granularity == "hour" ? point.date.format("HH:mm") : point.date.format("DD MMM"),
        }))}
      >
        <XAxis dataKey="date" tick={<CustomizedXAxisTick />} stroke="#394e5a" />
        <YAxis tick={<CustomizedYAxisTick />} stroke="#394e5a" />
        <CartesianGrid strokeDasharray="3 3" stroke="#394e5a" />
        <Legend onClick={handleClickOnLegend} formatter={value => legendLabels[value] ?? value} />
        <Tooltip
          wrapperStyle={{
            backgroundColor: "#22313a",
            border: "1px solid #394e5a",
          }}
          itemStyle={{ color: "#9bbcd1" }}
          labelStyle={{ color: "#dcf3ff" }}
          formatter={value => new Intl.NumberFormat("en").format(value)}
        />
        {dataToDisplay.includes("total") && (
          <Line dataKey="total" stroke={"rgb(135, 138, 252)"} hide={state.hide_total_data} {...commonLineProps} />
        )}
        {dataToDisplay.includes("success") && (
          <Line dataKey="success" stroke={"#2cc56f"} hide={state.hide_success_data} {...commonLineProps} />
        )}
        {dataToDisplay.includes("skip") && (
          <Line dataKey="skip" stroke={"#ffc021"} hide={state.hide_skip_data} {...commonLineProps} />
        )}
        {dataToDisplay.includes("errors") && (
          <Line dataKey="errors" stroke={"#e53935"} hide={state.hide_errors_data} {...commonLineProps} />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

const CustomizedXAxisTick = props => (
  <g transform={`translate(${props.x},${props.y})`}>
    <text x={0} y={0} dy={16} fontSize="10" textAnchor="end" fill="white">
      {props.payload.value}
    </text>
  </g>
)

const CustomizedYAxisTick = props => (
  <g transform={`translate(${props.x},${props.y})`}>
    <text x={0} y={0} fontSize="10" textAnchor="end" fill="white">
      {new Intl.NumberFormat("en").format(props.payload.value)}
    </text>
  </g>
)
