import * as React from "react"
import { Button, Card, Form, Input, message } from "antd"
import "./PasswordForm.less"

import LockOutlined from "@ant-design/icons/lib/icons/LockOutlined"
import ApplicationServices from "../../services/ApplicationServices"
import { handleError } from "../components"

import logo from "../../../icons/logo.svg"

type State = {
  loading?: boolean
}

export default class PasswordForm extends React.Component<any, State> {
  private services: ApplicationServices

  constructor(props: any, context: any) {
    super(props, context)
    this.services = ApplicationServices.get()
    this.state = { loading: false }
  }

  async passwordChange(values) {
    this.setState({ loading: true })
    try {
      let resetId = this.props.match.params.resetId
      await this.services.userService.changePassword(values["password"], resetId)
      message.success("Password has been changed!")
      setTimeout(() => {
        this.setState({ loading: false })
        window.location.href = "/"
      }, 800)
    } catch (error) {
      handleError(error)
      this.setState({ loading: false })
    }
  }

  render() {
    let title = (
      <div className="flex flex-col items-center justify-start">
        <img src={logo} alt="[logo]" className="h-16" />
        <h3 className="pt-6">Set your new password</h3>
      </div>
    )
    return (
      <Card
        title={title}
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
          onFinish={values => this.passwordChange(values)}
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
              <Button type="primary" htmlType="submit" className="login-form-button" loading={this.state.loading}>
                Save
              </Button>
            </div>
          </div>
        </Form>
      </Card>
    )
  }
}
