import { memo, useEffect, useRef, useState } from "react"
import { Form, Input, Button } from "antd"

type ChangeEmailFormValues = {
  email: string
}

const changeEmailInitialFormValues: ChangeEmailFormValues = {
  email: "",
}

type Props = {
  className?: string
  handleChangeEmail: (newEmail: string) => Promise<void>
  changeEmailDisabled: boolean
}

const ChangeEmailFormComponent: React.FC<Props> = ({ className, handleChangeEmail, changeEmailDisabled }) => {
  const inputRef = useRef(null)
  const [form] = Form.useForm<ChangeEmailFormValues>()
  const [showChangeEmailField, setShowChangeEmailField] = useState<boolean>(false)
  const [isChangeEmailInProgress, setIsChangeEmailInProgress] = useState<boolean>(false)

  const handleSubmitNewEmail = async ({ email }: ChangeEmailFormValues) => {
    setIsChangeEmailInProgress(true)
    await handleChangeEmail(email)
    setShowChangeEmailField(val => !val)
    setIsChangeEmailInProgress(false)
  }

  useEffect(() => {
    if (showChangeEmailField) inputRef.current?.focus?.()
  }, [showChangeEmailField])

  return (
    <span className={`flex items-start -mb-2 ${className || ""}`}>
      <Form
        form={form}
        className={`inline-block overflow-hidden max-h-14 max-w-xs transition-all duration-1000 ${
          showChangeEmailField ? "opacity-100 w-full mr-2" : "opacity-0 w-0"
        }`}
        requiredMark={false}
        initialValues={changeEmailInitialFormValues}
        onFinish={handleSubmitNewEmail}
      >
        <Form.Item
          name="email"
          rules={[
            {
              required: true,
              message: "Can not be empty",
            },
            {
              type: "email",
              message: "Invalid email format",
            },
          ]}
        >
          <Input ref={inputRef} type="email" autoComplete="email" className="w-full min-w-0" />
        </Form.Item>
      </Form>
      <Button
        type="primary"
        size="middle"
        disabled={changeEmailDisabled}
        loading={isChangeEmailInProgress}
        htmlType={showChangeEmailField ? "submit" : "button"}
        onClick={() => (showChangeEmailField ? form.submit() : setShowChangeEmailField(true))}
      >
        {showChangeEmailField ? "Confirm Email" : "Change Email"}
      </Button>
      {showChangeEmailField && (
        <Button type="default" className="ml-2" onClick={() => setShowChangeEmailField(false)}>
          {"Cancel"}
        </Button>
      )}
    </span>
  )
}

export const ChangeEmailForm = memo(ChangeEmailFormComponent)
