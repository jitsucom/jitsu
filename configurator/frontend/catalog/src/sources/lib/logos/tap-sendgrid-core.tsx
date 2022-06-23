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
        <rect fill="#263746" width={200} height={200} />
        <g>
          <polygon
            opacity={0.35}
            fill="#FFFFFF"
            points="31.2,77.1 31.2,122.9 77.1,122.9 77.1,168.8 122.9,168.8 122.9,77.1  "
          />
          <rect x={31.2} y={122.9} fill="#FFFFFF" width={45.9} height={45.9} />
          <polygon
            opacity={0.75}
            fill="#FFFFFF"
            points="122.9,77.1 122.9,31.2 77.1,31.2 77.1,77.1 77.1,122.9 122.9,122.9 168.8,122.9  168.8,77.1  "
          />
          <rect x={122.9} y={31.2} fill="#FFFFFF" width={45.9} height={45.9} />
        </g>
      </g>
    </svg>
  )
}

export default Svg
