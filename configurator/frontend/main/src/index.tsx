// @Libs
import ReactDOM from "react-dom"
import { BrowserRouter } from "react-router-dom"
// @App component
import { Application } from "./App"
// @Styles
import "./index.less"
import { getBaseUIPath } from "lib/commons/pathHelper"
import { ErrorBoundary } from "./lib/components/ErrorBoundary/ErrorBoundary"
import React from "react"

const BASE_PATH = getBaseUIPath()

ReactDOM.render(
  <BrowserRouter basename={BASE_PATH}>
    <ErrorBoundary>
      <Application />
    </ErrorBoundary>
  </BrowserRouter>,
  document.getElementById("root")
)
