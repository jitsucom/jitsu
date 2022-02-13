// @Libs
import ReactDOM from "react-dom"
import { BrowserRouter, Switch, Route } from "react-router-dom"
// @MobX
import "stores/_setupMobx"
// @App component
import  { Application } from "./App"
// @Styles
import "./index.less"
import { getBaseUIPath } from "lib/commons/pathHelper"
import { ErrorBoundary } from "./lib/components/ErrorBoundary/ErrorBoundary"
import React from "react"

const BASE_PATH = getBaseUIPath()

const Echo = (props) => {
  return <pre>JSON.stringify(props, null, 2)</pre>
}

ReactDOM.render(
  <BrowserRouter basename={BASE_PATH}>
    <ErrorBoundary>
      <Application />
    </ErrorBoundary>
  </BrowserRouter>,
  document.getElementById("root")
)
