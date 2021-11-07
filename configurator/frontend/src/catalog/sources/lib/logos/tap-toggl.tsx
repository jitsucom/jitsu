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
        <circle fill="#E1393F" cx={100} cy={100} r={90} />
        <path
          fill="#FFFFFF"
          d="M106.1,45.6H93.4v63.2h12.6V45.6z M99.7,146.8c-24.4-0.1-44.2-19.9-44.1-44.3c0-20,13.5-37.4,32.8-42.6 v13.1C72.1,79.2,64,97.5,70.3,113.8s24.6,24.4,40.9,18.1c16.3-6.3,24.4-24.6,18.1-40.9c-3.2-8.3-9.8-14.9-18.1-18.1V59.8 c23.6,6.3,37.6,30.6,31.2,54.2C137.2,133.3,119.7,146.7,99.7,146.8z"
        />
      </g>
    </svg>
  )
}

export default Svg
