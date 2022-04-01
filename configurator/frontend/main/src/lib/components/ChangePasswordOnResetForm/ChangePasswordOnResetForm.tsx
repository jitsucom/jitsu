// @Libs
import { useState } from "react"
import { useParams } from "react-router-dom"
import { Button, Card, Form, Input, message } from "antd"
// @Components
import { handleError } from "../components"
// @Hooks
import { useServices } from "hooks/useServices"
// @Icons
import logo from "icons/logo.svg"
import { LockOutlined } from "@ant-design/icons"
// @Utils
import { sleep } from "lib/commons/utils"
import { getBaseUIPath } from "lib/commons/pathHelper"
// @Styles
import "./ChangePasswordOnResetForm.less"

const ChangePasswordOnResetForm = () => {
  const services = useServices()
  const { resetId } = useParams<{ resetId?: string }>()
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const handleChangePassword = async values => {
    setIsLoading(true)
    try {
      await services.userService.changePassword(values["password"], resetId)
      message.success("Password has been changed!")
      await sleep(800)
      window.location.href = getBaseUIPath() ?? "/"
    } catch (error) {
      handleError(error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card
      title={
        <div className="flex flex-col items-center justify-start">
          <img src={logo} alt="[logo]" className="h-16" />
          <h3 className="pt-6">Set your new password</h3>
        </div>
      }
      style={{ margin: "auto", marginTop: "100px", maxWidth: "500px" }}
      bordered={false}
      className="password-form-card"
    >
      <Form
        name="password-form"
        className="password-form"
        initialValues={{
          remember: false,
        }}
        requiredMark={false}
        layout="vertical"
        onFinish={handleChangePassword}
      >
        <Form.Item
          name="password"
          rules={[
            {
              required: true,
              message: "Please input new Password!",
            },
          ]}
          label={<b>New Password</b>}
        >
          <Input prefix={<LockOutlined />} type="password" placeholder="Password" />
        </Form.Item>

        <div className="password-action-buttons">
          <div>
            <Button type="primary" htmlType="submit" className="login-form-button" loading={isLoading}>
              Save
            </Button>
          </div>
        </div>
      </Form>
    </Card>
  )
}

export default ChangePasswordOnResetForm
