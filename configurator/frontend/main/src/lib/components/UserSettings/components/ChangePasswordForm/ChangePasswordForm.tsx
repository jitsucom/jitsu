import { memo, useEffect, useRef, useState } from "react"
import { Form, Input, Button } from "antd"

type ChangePasswordFormValues = {
  password: string
}

const changePasswordInitialFormValues: ChangePasswordFormValues = {
  password: "",
}

type Props = {
  className?: string
  handleChangePassword: (newPassword: string) => Promise<void>
}

const ChangePasswordFormComponent: React.FC<Props> = ({ className, handleChangePassword }) => {
  const inputRef = useRef(null)
  const [form] = Form.useForm<ChangePasswordFormValues>()
  const [showChangePasswordField, setShowChangePasswordField] = useState<boolean>(false)
  const [isChangePasswordInProgress, setIsChangePasswordInProgress] = useState<boolean>(false)

  const handleSubmitNewPassword = async ({ password }: ChangePasswordFormValues) => {
    setIsChangePasswordInProgress(true)
    try {
      await handleChangePassword(password)
    } finally {
      setShowChangePasswordField(val => !val)
      setIsChangePasswordInProgress(false)
    }
  }

  useEffect(() => {
    if (showChangePasswordField) inputRef.current?.focus?.()
  }, [showChangePasswordField])

  return (
    <span className={`flex items-start -mb-2 ${className || ""}`}>
      <Form
        form={form}
        className={`inline-block overflow-hidden max-h-14 max-w-xs transition-all duration-1000 ${
          showChangePasswordField ? "opacity-100 w-full mr-2" : "opacity-0 w-0"
        }`}
        requiredMark={false}
        initialValues={changePasswordInitialFormValues}
        onFinish={handleSubmitNewPassword}
      >
        <Form.Item
          name="password"
          rules={[
            {
              required: true,
              message: "Can not be empty",
            },
          ]}
        >
          <Input.Password ref={inputRef} type="password" autoComplete="new-password" className="w-full min-w-0" />
        </Form.Item>
      </Form>
      <Button
        type="primary"
        size="middle"
        loading={isChangePasswordInProgress}
        htmlType={showChangePasswordField ? "submit" : "button"}
        onClick={() =>
          // handleChangePassword('')
          showChangePasswordField ? form.submit() : setShowChangePasswordField(true)
        }
      >
        {showChangePasswordField ? "Set New Password" : "Change Password"}
        {/* {'Reset Password'} */}
      </Button>
      {showChangePasswordField && (
        <Button type="default" className="ml-2" onClick={() => setShowChangePasswordField(false)}>
          {"Cancel"}
        </Button>
      )}
    </span>
  )
}

export const ChangePasswordForm = memo(ChangePasswordFormComponent)
