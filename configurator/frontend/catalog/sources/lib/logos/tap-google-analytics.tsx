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
        <path fill="#F2AF1C" d="M128.8,190H25c-8.3,0-15-6.7-15-15v-0.3h118.8V190z" />
        <path fill="#F79625" d="M190,25.3h-61.2V25c0-8.3,6.7-15,15-15H175c8.3,0,15,6.7,15,15V25.3z" />
        <path fill="#E77024" d="M175,190h-46.2v-15.3H190v0.3C190,183.3,183.3,190,175,190z" />
        <path fill="#FFD236" d="M66.7,127.9H25c-8.3,0-15,6.7-15,15v0.3h56.7V127.9z" />
        <path fill="#FFD236" d="M128.8,66.7H81.7c-8.3,0-15,6.7-15,15V82h62.1V66.7z" />
        <path
          fill="#FFCA05"
          d="M66.7,82v47.7H23.5c-7.5,0-13.5,6-13.5,13.5v31.5c0,7.5,6,13.5,13.5,13.5h105.3v-48.6v-9.9V68.5H80.2 C72.7,68.5,66.7,74.5,66.7,82z"
        />
        <path
          fill="#F48020"
          d="M175,188.2h-46.2V26.8c0-8.3,6.7-15,15-15H175c8.3,0,15,6.7,15,15v146.4C190,181.5,183.3,188.2,175,188.2z"
        />
        <linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1={128.8} y1={127.45} x2={190} y2={127.45}>
          <stop
            offset={0}
            style={{
              stopColor: "#EB7624",
            }}
          />
          <stop
            offset={0.7316}
            style={{
              stopColor: "#F17C22",
            }}
          />
          <stop
            offset={1}
            style={{
              stopColor: "#F48020",
            }}
          />
        </linearGradient>
        <path fill="url(#SVGID_1_)" d="M176.5,188.2h-47.7V66.7l61.2,64.8v43.2C190,182.2,184,188.2,176.5,188.2z" />
        <linearGradient id="SVGID_2_" gradientUnits="userSpaceOnUse" x1={128.8} y1={128.35} x2={136} y2={128.35}>
          <stop
            offset={0}
            style={{
              stopColor: "#E36C25",
            }}
          />
          <stop
            offset={0.4477}
            style={{
              stopColor: "#EC7722",
              stopOpacity: 0.5523,
            }}
          />
          <stop
            offset={1}
            style={{
              stopColor: "#F48020",
              stopOpacity: 0,
            }}
          />
        </linearGradient>
        <polygon fill="url(#SVGID_2_)" points="136,190 128.8,190 128.8,66.7 136,74.3  " />
      </g>
    </svg>
  )
}

export default Svg
