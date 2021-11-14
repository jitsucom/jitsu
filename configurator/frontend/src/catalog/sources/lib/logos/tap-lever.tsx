import * as React from "react"

function Svg(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      height="100%"
      width="100%"
      viewBox="0 0 200 200"
      {...props}
    >
      <defs>
        <style>
          {
            ".cls-1{fill:none;}.cls-2{clip-path:url(#clip-path);}.cls-3{fill:#c3c6cc;}.cls-3,.cls-4{fill-rule:evenodd;}.cls-4{fill:#e1e3e6;}"
          }
        </style>
        <clipPath id="clip-path">
          <rect className="cls-1" x={19.27} y={19.27} width={161.45} height={161.45} />
        </clipPath>
      </defs>
      <g id="Guidelines">
        <g className="cls-2">
          <path
            className="cls-3"
            d="M179.19,172.23l-30.39-30.4a5.13,5.13,0,0,0-7.19,0l-30.39,30.4a4.93,4.93,0,0,0,3.59,8.5H175.6C180.17,180.73,182.46,175.17,179.19,172.23Z"
          />
          <path
            className="cls-4"
            d="M180.2,63.05l-9.52-28.27a10.06,10.06,0,0,0-2-3.46L20.43,179.57a4.51,4.51,0,0,0,3.17,1.16H65.7a9,9,0,0,0,6.35-2.6L178.18,72A8.52,8.52,0,0,0,180.2,63.05Z"
          />
          <path
            className="cls-3"
            d="M165.2,29.3l-28.26-9.52a8.54,8.54,0,0,0-8.94,2L21.87,127.94a9,9,0,0,0-2.6,6.35V176.4a4.53,4.53,0,0,0,1.16,3.17L168.67,31.32A9.9,9.9,0,0,0,165.2,29.3Z"
          />
        </g>
      </g>
    </svg>
  )
}

export default Svg
