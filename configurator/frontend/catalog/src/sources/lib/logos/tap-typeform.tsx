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
      <rect fill="#262628" width={200} height={200} />
      <path fill="#FEFEFE" d="M79.6,81.6v-7.8h40.8v7.8h-16.3v44.7H96V81.6H79.6z" />
      <path
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2}
        d="M161.1,129.2c-5.1,11.6-10.6,20.4-18.2,27.6c-8.5,8.1-18.6,12.4-30.2,13.4 c-9.6,0.8-18.9-0.3-28.1-3.1c-9.4-2.8-17.9-7.1-25.3-13.6c-6.1-5.5-10.8-12.1-14.4-19.4c-5.6-11.3-9.4-23.2-11.1-35.8 c-1.1-8.1-1.2-16.2,0.9-24.1c2-7.6,6-14,11.5-19.4c5.5-5.4,11.8-9.5,18.6-12.9c10.4-5.2,21.4-9.1,32.8-11.1 c8.2-1.5,16.4-1.9,24.7-0.2c7.8,1.6,14.4,5.3,20.2,10.8c6.3,5.9,11,12.9,14.8,20.6c4.4,8.9,7.5,18.2,8.9,28.1 c1.4,9.8,0.7,19.5-1.9,29.1C163.2,123.2,161.7,127.2,161.1,129.2L161.1,129.2z"
      />
    </svg>
  )
}

export default Svg
