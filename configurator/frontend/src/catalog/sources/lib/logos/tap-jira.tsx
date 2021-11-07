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
      <rect fill="#004DCF" width={200} height={200} />
      <g>
        <path
          fill="#FFFFFF"
          d="M100,177.5c15.1-15.1,15.1-39.5,0-54.6c0,0,0,0,0,0l0,0L49.7,72.8L26.8,95.7c-2.4,2.4-2.4,6.3,0,8.7 L100,177.5L100,177.5z"
        />
        <path
          fill="#FFFFFF"
          d="M173.2,95.7L100,22.5l0,0l-0.2,0.2l0,0c-14.9,15.1-14.8,39.4,0.2,54.4l50.4,50.1l22.9-22.9 C175.6,101.9,175.6,98.1,173.2,95.7z"
        />
        <linearGradient
          id="SVGID_1_"
          gradientUnits="userSpaceOnUse"
          x1={98.7717}
          y1={41.0074}
          x2={67.1033}
          y2={9.3389}
          gradientTransform="matrix(1 0 0 -1 0 92)"
        >
          <stop
            offset={0.07}
            style={{
              stopColor: "#FFFFFF",
              stopOpacity: 0.4,
            }}
          />
          <stop
            offset={1}
            style={{
              stopColor: "#FFFFFF",
            }}
          />
        </linearGradient>
        <path fill="url(#SVGID_1_)" d="M100,77.1c-15-15-15.1-39.3-0.2-54.4L47.6,74.8l27.3,27.3L100,77.1z" />
        <linearGradient
          id="SVGID_2_"
          gradientUnits="userSpaceOnUse"
          x1={101.9928}
          y1={-56.2366}
          x2={136.691}
          y2={-21.5589}
          gradientTransform="matrix(1 0 0 -1 0 92)"
        >
          <stop
            offset={0.07}
            style={{
              stopColor: "#FFFFFF",
              stopOpacity: 0.4,
            }}
          />
          <stop
            offset={0.91}
            style={{
              stopColor: "#FFFFFF",
            }}
          />
        </linearGradient>
        <path
          fill="url(#SVGID_2_)"
          d="M125,97.9l-25,25c15.1,15.1,15.1,39.5,0,54.6c0,0,0,0,0,0l0,0l52.3-52.3L125,97.9z"
        />
      </g>
    </svg>
  )
}

export default Svg
