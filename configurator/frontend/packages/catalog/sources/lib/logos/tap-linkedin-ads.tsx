import * as React from "react"

function Svg(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      height="100%"
      width="100%"
      x="0px"
      y="0px"
      viewBox="0 0 200 200"
      enableBackground="new 0 0 200 200"
      xmlSpace="preserve"
      {...props}
    >
      <g id="Export">
        <rect fill="#0073B0" width={200} height={200} />
        <g>
          <path fill="#FFFFFF" d="M104.2,94.6v-0.2c0,0.1-0.1,0.1-0.1,0.2H104.2z" />
          <path
            fill="#FFFFFF"
            d="M146.9,44.7H53.1c-4.5,0-8.1,3.6-8.1,7.9v94.8c0,4.4,3.6,7.9,8.1,7.9h93.7c4.5,0,8.1-3.5,8.1-7.9V52.6 C155,48.2,151.4,44.7,146.9,44.7z M78.3,137.3H61.7v-50h16.6V137.3z M70,80.5L70,80.5h-0.1c-5.6,0-9.2-3.8-9.2-8.6 c0-4.9,3.7-8.6,9.4-8.6c5.7,0,9.2,3.7,9.3,8.6C79.4,76.7,75.8,80.5,70,80.5z M138.3,137.3h-16.6v-26.7c0-6.7-2.4-11.3-8.4-11.3 c-4.6,0-7.3,3.1-8.5,6.1c-0.4,1.1-0.5,2.6-0.5,4.1v27.9H87.5c0,0,0.2-45.3,0-50h16.6v7.1c2.2-3.4,6.2-8.3,15-8.3 c10.9,0,19.1,7.1,19.1,22.5V137.3z"
          />
        </g>
      </g>
      <g id="Guidelines" />
    </svg>
  )
}

export default Svg
