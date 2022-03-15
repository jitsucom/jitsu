// @Libs
import { useState } from "react"
import { Button, Form, Input, Modal } from "antd"
// @Services
import { useServices } from "hooks/useServices"
// @Components
import { handleError } from "lib/components/components"
// @Utils
import { reloadPage } from "lib/commons/utils"

export const SetNewPasswordModal: React.FC<{ onCompleted: () => Promise<void> }> = ({ onCompleted }) => {
  const [loading, setLoading] = useState(false)
  const services = useServices()
  const [form] = Form.useForm()
  return (
    <Modal
      title="Please, set a new password"
      visible={true}
      closable={false}
      footer={
        <>
          <Button
            onClick={() => {
              services.userService.removeAuth(reloadPage)
            }}
          >
            Logout
          </Button>
          <Button
            type="primary"
            loading={loading}
            onClick={async () => {
              setLoading(true)
              let values
              try {
                values = await form.validateFields()
              } catch (e) {
                //error will be displayed on the form, not need for special handling
                setLoading(false)
                return
              }

              try {
                let newPassword = values["password"]
                await services.userService.changePassword(newPassword)
                await services.userService.login(services.userService.getUser().email, newPassword)
                await services.userService.waitForUser()
                await services.storageService.saveUserInfo({ _forcePasswordChange: false })
                await onCompleted()
              } catch (e) {
                if ("auth/requires-recent-login" === e.code) {
                  services.userService.removeAuth(() => {
                    reloadPage()
                  })
                } else {
                  handleError(e)
                }
              } finally {
                setLoading(false)
              }
            }}
          >
            Set new password
          </Button>
        </>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="password"
          label="Password"
          rules={[
            {
              required: true,
              message: "Please input your password!",
            },
          ]}
          hasFeedback
        >
          <Input.Password />
        </Form.Item>

        <Form.Item
          name="confirm"
          label="Confirm Password"
          dependencies={["password"]}
          hasFeedback
          rules={[
            {
              required: true,
              message: "Please confirm your password!",
            },
            ({ getFieldValue }) => ({
              validator(rule, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve()
                }
                return Promise.reject("The two passwords that you entered do not match!")
              },
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  )
}
