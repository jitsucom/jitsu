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
      <rect fill="#002A45" width={200} height={200} />
      <g>
        <path
          fill="#FFFFFF"
          d="M152.8,64.7c-1.3-1.8-3.9-2.3-5.8-1l-102.7,71c0.8,1.1,2.1,1.8,3.4,1.8h101.7c2.3,0,4.2-1.9,4.2-4.2 c0,0,0,0,0-0.1V67.1C153.6,66.3,153.3,65.5,152.8,64.7"
        />
        <path fill="#FFFFFF" d="M50.1,63.7c-1.9-1.3-4.5-0.8-5.8,1c-0.5,0.7-0.7,1.5-0.7,2.3v65.3l48.8-39.4L50.1,63.7z" />
      </g>
    </svg>
  )
}

export default Svg
