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
      <rect fill="#1B2126" width={200} height={200} />
      <g>
        <path
          fill="#FFFFFF"
          d="M136.6,45H63.4C53.2,45,45,53.2,45,63.4v73.2c0,10.2,8.2,18.4,18.4,18.4h73.2c10.2,0,18.4-8.2,18.4-18.4 V63.4C155,53.2,146.8,45,136.6,45 M135,129.2c0,3.2-2.6,5.8-5.8,5.8H70.8c-3.2,0-5.8-2.6-5.8-5.8V70.8c0-3.2,2.6-5.8,5.8-5.8h58.4 c3.2,0,5.8,2.6,5.8,5.8V129.2z"
        />
        <path
          fill="#FFFFFF"
          d="M88.3,114.9c-1.8,0-3.3-1.5-3.3-3.3V88.3c0-1.8,1.5-3.3,3.3-3.3h23.3c1.8,0,3.3,1.5,3.3,3.3v23.3 c0,1.8-1.5,3.3-3.3,3.3H88.3z"
        />
      </g>
    </svg>
  )
}

export default Svg
