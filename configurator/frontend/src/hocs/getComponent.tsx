import React from "react"
import { RouteProps } from "react-router-dom"

const getComponent =
  <C extends {}>(Component: React.FC<C>, additionalProps: C) =>
  (currentProps: RouteProps) =>
    <Component {...additionalProps} {...currentProps} />

export { getComponent }
