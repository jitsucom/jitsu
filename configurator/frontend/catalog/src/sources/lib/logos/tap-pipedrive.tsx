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
      <rect fill="#203232" width={200} height={200} />
      <path
        fill="#FFFFFF"
        d="M110.8,29.8c-15.6,0-24.7,7-29,11.9c-0.5-4.2-3.3-9.6-14-9.6H44.3v24.4h9.6c1.6,0,2.1,0.5,2.1,2.1v111.6 h27.8v-41.9c0-1.1,0-2.2-0.1-3.1c4.3,4,12.6,9.5,25.6,9.5c27.2,0,46.2-21.6,46.2-52.4C155.7,50.9,137.6,29.8,110.8,29.8  M105.1,110.4c-15,0-21.8-14.3-21.8-27.6c0-20.9,11.4-28.4,22.2-28.4c13.1,0,22,11.3,22,28.2C127.4,101.9,116.2,110.4,105.1,110.4"
      />
    </svg>
  )
}

export default Svg
