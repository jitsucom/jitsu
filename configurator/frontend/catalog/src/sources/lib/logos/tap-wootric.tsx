import * as React from "react"

function Svg(props) {
  return (
    <svg
      id="Layer_1"
      xmlns="http://www.w3.org/2000/svg"
      height="100%"
      width="100%"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      x="0px"
      y="0px"
      viewBox="0 0 200 200"
      enableBackground="new 0 0 200 200"
      xmlSpace="preserve"
      {...props}
    >
      <circle fill="#88C34D" cx={100} cy={100} r={85} />
      <circle fill="#61873C" cx={100} cy={100} r={63.3} />
      <circle fill="#344828" cx={100} cy={100} r={33.7} />
    </svg>
  )
}

export default Svg
