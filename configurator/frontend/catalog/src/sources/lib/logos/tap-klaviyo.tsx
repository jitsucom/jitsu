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
      <rect fill="#0AD078" width={200} height={200} />
      <path
        fill="#FFFFFF"
        d="M32.8,95.5L95.6,54c2.5-1.6,6.3-1.6,8.8,0l62.8,41.6c3.8,2.5,3.8,6.5,0,9l-8.4,5.5 c-12.4-19.5-34.2-32.4-58.8-32.4c-24.8,0-46.4,13-58.8,32.4l-8.4-5.5C29.1,102.1,29.1,97.9,32.8,95.5z M100,95 c-18.7,0-35,9.9-44.4,24.6l14.5,9.6c6.1-10.1,17.1-16.8,29.8-16.8c12.6,0,23.7,6.7,29.8,16.8l14.5-9.6C135.1,105,118.7,95,100,95z  M100,129.8c-6.5,0-12.3,3.7-15.3,9l9.7,6.3c1.6,1.3,3.5,2.1,5.6,2.1c2.2,0,4.2-0.8,5.6-2.1l9.7-6.3 C112.4,133.6,106.6,129.8,100,129.8z"
      />
    </svg>
  )
}

export default Svg
