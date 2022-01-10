const baseStyle = {
  height: "35px",
  border: "none",
  textAlign: "center",
  verticalAlign: "center",
  boxShadow: "0 2px 4px 0 rgba(0,0,0,.25)",
  fontSize: "16px",
  lineHeight: "100%",
  display: "flex",
  alignItems: "center",
  padding: "1px",
  paddingRight: "1rem",
  borderRadius: "1px",
  transition: "background-color .218s, border-color .218s, box-shadow .218s",
  fontFamily: "Roboto,arial,sans-serif",
  cursor: "pointer",
  userSelect: "none",
} as const

export const darkStyle = {
  backgroundColor: "#4285f4",
  color: "#fff",
  ...baseStyle,
} as const

export const lightStyle = {
  backgroundColor: "#fff",
  color: "rgba(0,0,0,.54)",
  ...baseStyle,
} as const

export const iconStyle = {
  height: "100%",
  textAlign: "center",
  verticalAlign: "center",
  display: "block",
  marginRight: "1rem",
  backgroundColor: "#fff",
  borderRadius: "1px",
  whiteSpace: "nowrap",
} as const

export const svgStyle = {
  display: "block",
} as const

export const hoverStyle = {
  boxShadow: "0 0 3px 3px rgba(66,133,244,.3)",
  transition: "background-color .218s, border-color .218s, box-shadow .218s",
} as const

export const disabledStyle = {
  backgroundColor: "rgba(37, 5, 5, .08)",
  color: "rgba(0, 0, 0, .40)",
  cursor: "not-allowed",
} as const

export const disabledIconStyle = {
  backgroundColor: "transparent",
} as const
