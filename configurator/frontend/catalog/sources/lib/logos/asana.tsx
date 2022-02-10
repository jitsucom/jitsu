import * as React from "react"

function Svg(props) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 1 1" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M0.782522 0.529408C0.662399 0.529408 0.565037 0.634747 0.565037 0.764696C0.565037 0.894652 0.662399 1 0.782522 1C0.902631 1 1 0.894652 1 0.764696C1 0.634747 0.902631 0.529408 0.782522 0.529408ZM0.217482 0.529424C0.0973733 0.529424 0 0.634747 0 0.764708C0 0.894652 0.0973733 1 0.217482 1C0.337597 1 0.434974 0.894652 0.434974 0.764708C0.434974 0.634747 0.337597 0.529424 0.217482 0.529424ZM0.717476 0.235288C0.717476 0.365236 0.620114 0.4706 0.500006 0.4706C0.379886 0.4706 0.28252 0.365236 0.28252 0.235288C0.28252 0.105348 0.379886 0 0.500006 0C0.620114 0 0.717476 0.105348 0.717476 0.235288Z"
        fill="url(#paint0_radial)"
      />
      <defs>
        <radialGradient
          id="paint0_radial"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(0.5 0.546522) scale(0.662633)"
        >
          <stop stopColor="#FFB900" />
          <stop offset="0.6" stopColor="#F95D8F" />
          <stop offset="0.9991" stopColor="#F95353" />
        </radialGradient>
      </defs>
    </svg>
  )
}

export default Svg
