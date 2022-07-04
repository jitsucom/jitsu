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
      style={{
        enableBackground: "new 0 0 200 200",
      }}
      xmlSpace="preserve"
      {...props}
    >
      <rect
        x={0}
        style={{
          fill: "#33547D",
        }}
        width={200}
        height={200}
      />
      <g>
        <path
          style={{
            fill: "#FFFFFF",
          }}
          d="M52.7,84c8.8,0,16,7.2,16,16s-7.2,16-16,16s-16-7.2-16-16S43.9,84,52.7,84"
        />
        <circle
          style={{
            fill: "#FFFFFF",
          }}
          cx={110.5}
          cy={100.2}
          r={11.3}
        />
        <circle
          style={{
            fill: "#FFFFFF",
          }}
          cx={158.1}
          cy={100.2}
          r={5.1}
        />
      </g>
    </svg>
  )
}

export default Svg
