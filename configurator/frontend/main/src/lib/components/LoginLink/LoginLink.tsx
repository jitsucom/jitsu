import { useHistory, useLocation, useParams } from "react-router-dom"
import { useServices } from "hooks/useServices"
import React, { useState } from "react"
import { Card } from "antd"
import { Preloader } from "lib/components/components"
import CheckCircleOutlined from "@ant-design/icons/lib/icons/CheckCircleOutlined"
import CloseCircleOutlined from "@ant-design/icons/lib/icons/CloseCircleOutlined"
import * as QueryString from "query-string"
import { reloadPage } from "lib/commons/utils"

export function LoginLink() {
  const location = useLocation()
  const params = useParams<{ emailEncoded?: string }>()
  const [emailSent, setEmailSent] = useState(false)
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)
  const history = useHistory()
  const services = useServices()
  let email = (QueryString.parse(location.search).email as string) || (params.emailEncoded && atob(params.emailEncoded))

  //http://localhost:9876/link-login/dkBrbG1uLmlv?apiKey=AIzaSyDBm2HqvxleuJyD9xo8rh0vo1TQGp8Vohg&oobCode=oGsY0GtCiHeekTMzzWYYRgYvGfbsN_cBzzg5kEVqydUAAAF6PfpF3Q&mode=signIn&lang=en
  const userService = services.userService
  if (!userService.supportsLoginViaLink()) {
    history.push("/login")
    return null
  }
  if (error) {
    return (
      <div className="w-2/4 mx-auto mt-16">
        <Card
          title={
            <>
              <h2 className="text-error">
                <CloseCircleOutlined /> Error occurred
              </h2>
            </>
          }
          bordered={false}
        >
          <div className="text-xl">
            Failed to sign in <b>{email}</b>: {error.message}
          </div>
        </Card>
      </div>
    )
  } else if (emailSent) {
    return (
      <div className="w-2/4 mx-auto mt-16">
        <Card
          title={
            <>
              <h2 className="text-success">
                <CheckCircleOutlined /> Check your email!
              </h2>
            </>
          }
          bordered={false}
        >
          <div className="text-xl">
            Magic login link has been sent to <b>{email}</b>. Check your inbox to login to Jitsu.Cloud
          </div>
        </Card>
      </div>
    )
  } else if (loading) {
    return <Preloader text={loading} />
  } else if (userService.isEmailLoginLink(window.location.href)) {
    if (!email) {
      email = window.prompt("Please provide your email for confirmation")
    }
    setLoading("Signing in...")
    userService
      .loginWithLink(email, window.location.href)
      .then(result => {
        history.push("/dashboard")
        reloadPage()
      })
      .catch(error => {
        setError(error)
      })
  } else if (email && !loading) {
    setLoading("Sending sign-in link to " + email)
    userService
      .sendLoginLink(email as string)
      .then(() => {
        setEmailSent(true)
        setLoading(null)
      })
      .catch(error => {
        setError(error)
      })
  } else {
    let email = prompt("Please enter email")
    history.push(`/login-link/${btoa(email)}`)
    return null
  }
}
