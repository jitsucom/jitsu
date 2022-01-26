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
      <g>
        <linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1={100} y1={0} x2={100} y2={200}>
          <stop
            offset={0}
            style={{
              stopColor: "#F99916",
            }}
          />
          <stop
            offset={1}
            style={{
              stopColor: "#F86606",
            }}
          />
        </linearGradient>
        <rect fill="url(#SVGID_1_)" width={200} height={200} />
      </g>
      <polygon
        fill="#FFFFFF"
        points="61.4,159.8 61.4,40.2 83.9,40.2 83.9,88 116.1,88 116.1,40.2 138.6,40.2 138.6,159.8 116.1,159.8  116.1,108.3 83.9,108.3 83.9,159.8 "
      />
    </svg>
  )
}

export default Svg
