import { useHistory, useLocation } from "react-router-dom"
import React, { useEffect } from "react"
import * as QueryString from "query-string"
import { LS_ACCESS_KEY, LS_REFRESH_KEY } from "../../services/UserServiceBackend"
import { SSO_ERROR_LS_KEY } from "../../../ui/pages/GetStartedPage/LoginForm"

export function SSOCallback() {
  const location = useLocation()
  const history = useHistory()
  const queryString = QueryString.parse(location.search)
  const error = queryString.error as string
  const enAccess = queryString.a as string
  const enRefresh = queryString.r as string

  useEffect(() => {
    if (!error && enAccess && enRefresh) {
      localStorage.setItem(LS_ACCESS_KEY, enAccess)
      localStorage.setItem(LS_REFRESH_KEY, enRefresh)
    } else {
      localStorage.setItem(SSO_ERROR_LS_KEY, error || "SSOCallback error. Please contact support@jitsu.com")
    }
    history.push("/")
    history.go(0)
  })
  return null
}
