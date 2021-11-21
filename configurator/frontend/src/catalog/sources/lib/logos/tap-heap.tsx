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
      <linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1={149.5981} y1={152.6356} x2={51.041} y2={48.0426}>
        <stop
          offset={0}
          style={{
            stopColor: "#DD4362",
          }}
        />
        <stop
          offset={0.5671}
          style={{
            stopColor: "#EE633F",
          }}
        />
        <stop
          offset={1}
          style={{
            stopColor: "#FB7C24",
          }}
        />
      </linearGradient>
      <path
        fill="url(#SVGID_1_)"
        d="M100,10L23.4,55.4v89.1L100,190l76.6-45.4V55.4L100,10z M99.8,173.4l-62.4-37V64.3l62.4-37v74 l62.4-37v72.2L99.8,173.4z"
      />
    </svg>
  )
}

export default Svg
