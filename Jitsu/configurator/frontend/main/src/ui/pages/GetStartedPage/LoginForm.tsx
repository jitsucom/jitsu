import { useEffect, useState } from "react"
import { useHistory } from "react-router-dom"
import { Button, Form, Input, message, Modal } from "antd"
import { FloatingLabelInput } from "../../components/FloatingLabelInput/FloatingLabelInput"
import MailOutlined from "@ant-design/icons/lib/icons/MailOutlined"
import LockOutlined from "@ant-design/icons/lib/icons/LockOutlined"
import Icon from "@ant-design/icons"
import githubLogo from "../../../icons/github.svg"
import googleLogo from "../../../icons/google.svg"
import { reloadPage } from "../../../lib/commons/utils"
import { getErrorPayload } from "../../../lib/services/analytics"
import { useServices } from "../../../hooks/useServices"
import ApplicationServices from "../../../lib/services/ApplicationServices"
import UserOutlined from "@ant-design/icons/lib/icons/UserOutlined"

export const SSO_ERROR_LS_KEY = "sso_error"

export function LoginForm({ supportOauth, ssoAuthLink }) {
  const services = useServices()
  const [loading, setLoading] = useState(false)
  const history = useHistory()
  const [showPasswordResetForm, setShowPasswordResetForm] = useState(false)

  useEffect(() => {
    const ssoError = localStorage.getItem(SSO_ERROR_LS_KEY)
    if (ssoError) {
      message.error(ssoError)
      localStorage.removeItem(SSO_ERROR_LS_KEY)
    }
  }, [])

  const githubSignIn = async () => {
    try {
      const email = await services.userService.initiateGithubLogin()
      await services.analyticsService.track("app_login", { user: { email }, login_type: "github" })
      reloadPage()
    } catch (error) {
      message.destroy()
      services.analyticsService.track("failed_app_login", {
        user: { email: null },
        login_type: "github",
        ...getErrorPayload(error),
      })
      console.log("Github auth error", error)
      message.error("Access denied: " + error.message)
    } finally {
      setLoading(false)
    }
  }

  const googleSignIn = async () => {
    try {
      const email = await services.userService.initiateGoogleLogin()
      await services.analyticsService.track("app_login", { user: { email }, login_type: "google" })
      reloadPage()
    } catch (error) {
      message.destroy()
      services.analyticsService.track("failed_app_login", {
        user: { email: null },
        login_type: "google",
        ...getErrorPayload(error),
      })
      console.log("Google auth error", error)
      message.error("Access denied: " + error.message)
    } finally {
      setLoading(false)
    }
  }

  const passwordSignIn = async values => {
    setLoading(true)
    const email = values["email"].trim()
    const password = values["password"].trim()
    try {
      await services.userService.login(email.trim(), password)
      await services.analyticsService.track("app_login", { user: { email }, login_type: "password" })
      reloadPage()
    } catch (error) {
      message.destroy()
      await services.analyticsService.track("failed_app_login", {
        user: { email },
        login_type: "password",
        ...getErrorPayload(error),
      })
      console.log("Error", error)
      message.error("Invalid login or password")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PasswordResetForm
        key="password-reset-form"
        visible={showPasswordResetForm}
        close={() => setShowPasswordResetForm(false)}
        onSuccess={() => message.info("Password reset e-mail has been sent!")}
      />
      <h1 className="text-center text-textPale font-heading font-bold tracking-wider mb-4 mt-12">Log in to Jitsu</h1>
      {supportOauth && (
        <div className="block lg:hidden mt-6 text-center mb-6 font-bold">
          New to Jitsu? <a onClick={() => history.push("/signup")}>Sign up</a>
        </div>
      )}
      <Form
        name="signup-form"
        className="signup-form"
        initialValues={{
          remember: false,
        }}
        requiredMark={false}
        layout="vertical"
        onFinish={passwordSignIn}
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

        <div className="text-center">
          <div className="mb-4">
            <Button type="primary" className="w-full" htmlType="submit" size="large" loading={loading}>
              Login
            </Button>
          </div>
          {ssoAuthLink && (
            <div className="mb-4">
              <Button href={ssoAuthLink} size="large" className="w-full">
                Continue with SSO
              </Button>
            </div>
          )}
          <div>
            <a onClick={() => setShowPasswordResetForm(true)}>Forgot password?</a>
          </div>
          {supportOauth && (
            <>
              <div className="mb-4 mt-4">Or sign in with</div>
              <div className="flex space-x-4 justify-center">
                <Button
                  size="large"
                  onClick={githubSignIn}
                  icon={<Icon component={() => <img className="h-4 align-baseline" src={githubLogo} />} />}
                >
                  Github
                </Button>
                <Button
                  size="large"
                  onClick={googleSignIn}
                  icon={<Icon component={() => <img className="h-4 align-baseline" src={googleLogo} />} />}
                >
                  Google
                </Button>
              </div>
            </>
          )}
        </div>
      </Form>
    </div>
  )
}

function PasswordResetForm({ visible, onSuccess, close }) {
  let services = ApplicationServices.get()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>()
  const [form] = Form.useForm()

  const onSubmit = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()
      await services.userService.sendPasswordReset(values["email"])
      onSuccess()
      close()
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Password reset. Please, enter your email"
      visible={visible}
      closable={true}
      onCancel={close}
      footer={
        <>
          <Button key="close" onClick={close}>
            Cancel
          </Button>
          <Button key="submit" type="primary" loading={loading} onClick={onSubmit}>
            Submit
          </Button>
        </>
      }
    >
      <Form layout="vertical" form={form} name="password-reset-form" className="password-reset-form">
        <Form.Item
          name="email"
          rules={[
            {
              required: true,
              message: "Email can't be empty!",
            },
          ]}
        >
          <Input prefix={<UserOutlined className="site-form-item-icon" />} placeholder="E-mail" />
        </Form.Item>
        <div className={`text-error ${error ? "visible" : "invisible"}`}>{error?.message || "-"}</div>
      </Form>
    </Modal>
  )
}
