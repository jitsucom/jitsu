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
      <linearGradient
        id="SVGID_1_"
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={-108}
        x2={200}
        y2={92}
        gradientTransform="matrix(1 0 0 -1 0 92)"
      >
        <stop
          offset={0}
          style={{
            stopColor: "#F58A2A",
          }}
        />
        <stop
          offset={0}
          style={{
            stopColor: "#FA8C28",
          }}
        />
        <stop
          offset={0.2316}
          style={{
            stopColor: "#EE7223",
          }}
        />
        <stop
          offset={0.5309}
          style={{
            stopColor: "#E1571D",
          }}
        />
        <stop
          offset={0.7968}
          style={{
            stopColor: "#DA471A",
          }}
        />
        <stop
          offset={1}
          style={{
            stopColor: "#D74119",
          }}
        />
      </linearGradient>
      <rect fill="url(#SVGID_1_)" width={200} height={200} />
      <g>
        <path
          fill="#FFFFFF"
          d="M128,40l-20,13.3V124l0,0c0,6.7-3.3,12.7-8.5,16.3c-4.8-3.8-7.5-10-7.5-16.3v-4c0-4-4-8-4-12 c0-2.8,2-5.5,3.2-8.3c0.5-1.2,0.8-2.3,0.8-3.7c0-4.5-3.5-8-8-8s-8,3.5-8,8c0,1.3,0.3,2.5,0.8,3.7c1.2,2.8,3.2,5.5,3.2,8.3 c0,4-4,8-4,12v4c0,7.2,2.2,13.7,6,19.2c-8.2-2.5-14-10.2-14-19.2l0,0v-4c0-4-4-8-4-12c0-2.8,2-5.5,3.2-8.3c0.5-1.2,0.8-2.3,0.8-3.7 c0-4.5-3.5-8-8-8s-8,3.5-8,8c0,1.3,0.3,2.5,0.8,3.7c1.2,2.8,3.2,5.5,3.2,8.3c0,4-4,8-4,12v4l0,0c0,19.8,16.2,36,36,36 s36-16.2,36-36l0,0V61.2l4-2.7l4,2.7c0,0,0,61.8,0,62.2c0,13.3-4,26.7-19.2,36c15.5,0,34.7-17.3,35.2-40v-66L128,40z"
        />
        <circle fill="#FFFFFF" cx={84} cy={74.3} r={8} />
        <circle fill="#FFFFFF" cx={84} cy={52.8} r={8} />
        <circle fill="#FFFFFF" cx={60} cy={74.3} r={8} />
        <circle fill="#FFFFFF" cx={60} cy={52.8} r={8} />
      </g>
    </svg>
  )
}

export default Svg
