import React, { useState } from "react"
import { GoogleIcon } from "./GoogleIcons"
import { darkStyle, lightStyle, disabledStyle, hoverStyle } from "./styles"

export const GoogleSignInButton: React.FC<{
  label?: string
  disabled?: boolean
  type?: "light" | "dark"
  style?: React.CSSProperties
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void | Promise<void>
}> = props => {
  const { label = "Sign In with Google", style, ...containerProps } = props
  const { disabled = false, type = "dark", onClick } = containerProps

  const [hovered, setHovered] = useState<boolean>(false)

  const getStyle = propStyles => {
    const baseStyle = type === "dark" ? darkStyle : lightStyle
    if (hovered) {
      return { ...baseStyle, ...hoverStyle, ...propStyles }
    }
    if (disabled) {
      return { ...baseStyle, ...disabledStyle, ...propStyles }
    }
    return { ...baseStyle, ...propStyles }
  }

  const handleMouseOver = () => {
    if (!disabled) {
      setHovered(true)
    }
  }

  const handleMouseOut = () => {
    if (!disabled) {
      setHovered(false)
    }
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!disabled) {
      onClick(event)
    }
  }

  return (
    <div
      {...containerProps}
      role="button"
      style={getStyle(style)}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
      onClick={handleClick}
    >
      <GoogleIcon {...props} />
      <span>{label}</span>
    </div>
  )
}
