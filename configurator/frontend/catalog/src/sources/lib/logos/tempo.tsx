import * as React from "react"

function Svg(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="100%"
      height="100%"
      {...props}
    >
      <g transform="matrix(.885201 0 0 .885201 .000008 .044271)">
        <defs>
          <path
            id="A"
            d="M44.3 25.5l-9.9 9.8c-.3.3-.9.3-1.2 0l-4.1-4.1c-.3-.3-.9-.3-1.2 0l-4.7 4.7c-.3.3-.3.9 0 1.3l10 10c.3.3.9.3 1.2 0l15.8-15.7c.3-.3.3-.9 0-1.2l-4.7-4.7c-.3-.5-.9-.5-1.2-.1z"
          />
        </defs>
        <clipPath id="B">
          <use xlinkHref="#A" />
        </clipPath>
        <path clipPath="url(#B)" d="M17.9 20.2h37.5v32.2H17.9z" fill="#222527" />
        <defs>
          <path
            id="C"
            d="M36.2 13.4c12.5 0 22.7 10.2 22.7 22.7S48.8 58.8 36.2 58.8c-12.5 0-22.7-10.1-22.7-22.7 0-12.5 10.2-22.7 22.7-22.7zm0-8.3c-17.1 0-31 13.9-31 31s13.9 31 31 31 31-13.9 31-31-14-31-31-31z"
          />
        </defs>
        <clipPath id="D">
          <use xlinkHref="#C" />
        </clipPath>
        <path clipPath="url(#D)" d="M.2.1h72v72H.2z" fill="#31c4f3" />
        <defs>
          <path id="E" d="M36.2 5.3c2 0 3.9.2 5.8.5L36.2 0C16.2 0 .1 16.2.1 36.1l5.8-5.8c2.7-14.2 15.3-25 30.3-25z" />
        </defs>
        <clipPath id="F">
          <use xlinkHref="#E" />
        </clipPath>
        <path clipPath="url(#F)" d="M-4.9-5H47v46.1H-4.9z" fill="#0093b5" />
        <defs>
          <path id="G" d="M66.5 41.9c-2.7 14.2-15.3 25-30.3 25-2 0-3.9-.2-5.8-.5l5.8 5.8c19.9 0 36.1-16.2 36.1-36.1z" />
        </defs>
        <clipPath id="H">
          <use xlinkHref="#G" />
        </clipPath>
        <path clipPath="url(#H)" d="M25.3 31.1h51.9v46.1H25.3z" fill="#0093b5" />
        <defs>
          <path
            id="I"
            d="M67 36.1c0 2-.2 3.9-.5 5.8l5.8-5.8C72.3 16.2 56.1 0 36.2 0L42 5.8c14.2 2.8 25 15.3 25 30.3z"
          />
        </defs>
        <clipPath id="J">
          <use xlinkHref="#I" />
        </clipPath>
        <path clipPath="url(#J)" d="M31.2-5h46.1v51.9H31.2z" fill="#7ec142" />
        <defs>
          <path
            id="K"
            d="M5.3 36.1c0-2 .2-3.9.5-5.8L0 36.1c.1 20 16.2 36.1 36.2 36.1l-5.8-5.8C16.1 63.6 5.3 51.1 5.3 36.1z"
          />
        </defs>
        <clipPath id="L">
          <use xlinkHref="#K" />
        </clipPath>
        <path clipPath="url(#L)" d="M-4.9 25.3h46.1v51.9H-4.9z" fill="#f6921e" />
      </g>
    </svg>
  )
}

export default Svg
