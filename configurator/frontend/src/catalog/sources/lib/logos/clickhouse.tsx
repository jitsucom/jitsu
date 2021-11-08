import * as React from "react"

function Svg(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 9 8" {...props}>
      <style>{".o{fill:#fc0}.r{fill:red}"}</style>
      <path d="M0,7 h1 v1 h-1 z" className="r" />
      <path d="M0,0 h1 v7 h-1 z" className="o" />
      <path d="M2,0 h1 v8 h-1 z" className="o" />
      <path d="M4,0 h1 v8 h-1 z" className="o" />
      <path d="M6,0 h1 v8 h-1 z" className="o" />
      <path d="M8,3.25 h1 v1.5 h-1 z" className="o" />
    </svg>
  )
}

export default Svg
