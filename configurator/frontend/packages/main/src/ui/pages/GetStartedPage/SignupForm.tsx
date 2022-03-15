import { useState } from "react"
import { useServices } from "../../../hooks/useServices"
import { Button, Checkbox, Form, message } from "antd"
import { reloadPage } from "../../../lib/commons/utils"
import { handleError } from "../../../lib/components/components"
import { NavLink } from "react-router-dom"
import { FloatingLabelInput } from "../../components/FloatingLabelInput/FloatingLabelInput"
import MailOutlined from "@ant-design/icons/lib/icons/MailOutlined"
import LockOutlined from "@ant-design/icons/lib/icons/LockOutlined"
import Icon from "@ant-design/icons"
import githubLogo from "../../../icons/github.svg"
import { default as googleLogo } from "../../../icons/google.svg"
import { SignupRequest } from "../../../generated/conf-openapi"

export function SignupForm() {
  const [tosAgree, setTosAgree] = useState(false)
  const [tosHighlight, setTosHighlight] = useState(false)
  const [loading, setLoading] = useState(false)
  const services = useServices()

  const googleSignup = async () => {
    try {
      if (!tosAgree) {
        message.error("To sign up you need to agree to the terms of service")
        setTosHighlight(true)
        return
      }
      await services.userService.initiateGoogleLogin()
      message.destroy()
      reloadPage()
    } catch (error) {
      message.destroy()
      console.log("Google auth error", error)
      message.error("Google signup is unavailable: " + error.message)
    }
  }

  const githubSignup = async () => {
    try {
      if (!tosAgree) {
        message.error("To sign up you need to agree to the terms of service")
        setTosHighlight(true)
        return
      }
      await services.userService.initiateGithubLogin()
      message.destroy()
      reloadPage()
    } catch (error) {
      message.destroy()
      console.log("Github auth error", error)
      message.error("Github auth is unavailable: " + error.message)
    }
  }

  const passwordSignup = async values => {
    if (!tosAgree) {
      message.error("To sign up you need to agree to the terms of service")
      setTosHighlight(true)
      return
    }
    setLoading(true)
    try {
      await services.userService.createUser(values as SignupRequest)
      reloadPage()
    } catch (error) {
      handleError(error)
      setLoading(false)
    }
  }

  return (
    <div>
      <h1 className="text-center text-textPale font-heading font-bold tracking-wider mb-4">Get Started</h1>
      <div className="text-center mb-6">
        <b>
          <NavLink to="/">Log in</NavLink>
        </b>{" "}
        if you have an account
      </div>
      <Form
        name="signup-form"
        className="signup-form"
        initialValues={{
          remember: false,
        }}
        requiredMark={false}
        layout="vertical"
        onFinish={passwordSignup}
      >
        <FloatingLabelInput
          formName="signup-form"
          name="email"
          rules={[
            {
              required: true,
              message: "Please input your email!",
            },
            { type: "email", message: "Invalid email format" },
          ]}
          floatingLabelText="E-mail"
          prefix={<MailOutlined />}
          size="large"
          inputType="email"
        />

        <FloatingLabelInput
          formName="signup-form"
          size="large"
          name="password"
          rules={[
            {
              required: true,
              message: "Please input your Password!",
            },
          ]}
          floatingLabelText="Password"
          prefix={<LockOutlined />}
          inputType="password"
        />
        <Form.Item name="agreeToTos" className="signup-checkboxes">
          <Checkbox
            className={tosHighlight && "border-b-2 border-error"}
            defaultChecked={true}
            checked={tosAgree}
            onChange={() => setTosAgree(!tosAgree)}
          >
            <span>
              I agree to <a href="https://jitsu.com/tos">Terms of Services</a> and{" "}
              <a href="https://jitsu.com/privacy">Privacy Policy</a>
            </span>
          </Checkbox>
        </Form.Item>

        <div className="text-center">
          <div className="mb-4">
            <Button type="primary" htmlType="submit" size="large" loading={loading}>
              Create Account
            </Button>
          </div>
          <div className="mb-4">Or sign up with</div>
          <div className="flex space-x-4 justify-center">
            <Button
              size="large"
              onClick={githubSignup}
              icon={<Icon component={() => <img className="h-4 align-baseline" src={githubLogo} />} />}
            >
              Github
            </Button>
            <Button
              size="large"
              onClick={googleSignup}
              icon={<Icon component={() => <img className="h-4 align-baseline" src={googleLogo} />} />}
            >
              Google
            </Button>
          </div>
        </div>
      </Form>
    </div>
  )
}
