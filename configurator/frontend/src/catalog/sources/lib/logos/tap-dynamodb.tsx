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
      <rect fill="#1E2023" width={200} height={200} />
      <path
        fill="#FFCC00"
        d="M69.1,73l-3.3-10.8h68.3L131,73H69.1L69.1,73z M100,38.8c4.2,0,7.6,3.4,7.6,7.6S104.2,54,100,54 c-4.2,0-7.6-3.4-7.6-7.6S95.8,38.8,100,38.8L100,38.8z M134.1,137.7H65.8l3.3-10.8H131L134.1,137.7L134.1,137.7z M100,161.2 c-4.2,0-7.6-3.4-7.6-7.6c0-4.2,3.4-7.6,7.6-7.6c4.2,0,7.6,3.4,7.6,7.6C107.5,157.8,104.2,161.2,100,161.2L100,161.2z M177,83.8V23 H23v82.4h105.9v10.8H23v0V177h154V94.6H71.1V83.8H177L177,83.8z"
      />
    </svg>
  )
}

export default Svg
