import * as React from "react"

function Svg(props) {
  return (
    <svg
      id="Layer_1"
      height="100%"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      x="0px"
      y="0px"
      viewBox="0 0 200 200"
      enableBackground="new 0 0 200 200"
      xmlSpace="preserve"
      {...props}
    >
      <rect fill="#2EDAB8" width={200} height={200} />
      <g>
        <polygon fill="#FFFFFF" points="41.7,89.9 158.3,89.9 178.4,61.8 21.6,61.8  " />
        <polygon fill="#FFFFFF" points="60.8,138.2 137.2,138.2 157.3,110.1 42.7,110.1  " />
      </g>
    </svg>
  )
}

export default Svg
