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
          fill: "#3664A2",
        }}
        width={200}
        height={200}
      />
      <path
        style={{
          fill: "#FFFFFF",
        }}
        d="M125.6,81.2h-17.2v-9.5c0-4.9,0.4-7.5,7.5-7.5h9.5v-19h-15.2c-18.1,0-24.5,9.3-24.5,24.5V81H74.4v19 h11.3v54.8h22.8V100h15.2L125.6,81.2z"
      />
    </svg>
  )
}

export default Svg
