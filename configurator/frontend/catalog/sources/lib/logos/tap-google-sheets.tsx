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
        <path
          fill="#22A565"
          d="M153.1,190H46.9c-6.8,0-12.3-5.5-12.3-12.3V22.3c0-6.8,5.5-12.3,12.3-12.3H115l50.4,49.2v118.5 C165.4,184.5,159.8,190,153.1,190z"
        />
        <path
          fill="#FFFFFF"
          d="M65.4,98.1v60.4h66.2V98.1H65.4z M73.1,123.5h21.2v10H73.1V123.5z M101.9,123.5h21.9v10h-21.9V123.5z  M123.8,115.8h-21.9v-10h21.9V115.8z M94.2,105.8v10H73.1v-10H94.2z M73.1,141.2h21.2v9.6H73.1V141.2z M101.9,150.8v-9.6h21.9v9.6 H101.9z"
        />
        <path fill="#8ED1B1" d="M165.4,59.2h-38.5c-6.8,0-12.3-5.5-12.3-12.3V10" />
        <linearGradient
          id="SVGID_1_"
          gradientUnits="userSpaceOnUse"
          x1={144.4231}
          y1={101.1538}
          x2={144.4231}
          y2={59.4444}
        >
          <stop
            offset={0}
            style={{
              stopColor: "#000000",
              stopOpacity: 0,
            }}
          />
          <stop
            offset={1}
            style={{
              stopColor: "#000000",
              stopOpacity: 0.2,
            }}
          />
        </linearGradient>
        <path opacity={0.9} fill="url(#SVGID_1_)" d="M165.4,59.6v41.5l-41.9-41.5C123.5,59.6,165.4,59.2,165.4,59.6z" />
      </g>
    </svg>
  )
}

export default Svg
