import { memo, useState } from 'react';
import { Form, Input, Button } from 'antd'

type ChangeEmailFormValues = {
  email: string;
}

const changeEmailInitialFormValues: ChangeEmailFormValues = {
  email: ''
}

type Props = {
  className?: string,
  handleChangeEmail: (newEmail: string) => Promise<void>;
}

const ChangeEmailFormComponent: React.FC<Props> = ({
  className,
  handleChangeEmail
}) => {
  const [form] = Form.useForm<ChangeEmailFormValues>();
  const [showChangeEmailField, setShowChangeEmailField] = useState<boolean>(false);
  const [isChangeEmailInProgress, setIsChangeEmailInProgress] = useState<boolean>(false);

  const handleSubmitNewEmail = async({ email }: ChangeEmailFormValues) => {
    setIsChangeEmailInProgress(true);
    await handleChangeEmail(email);
    setShowChangeEmailField(val => !val)
    setIsChangeEmailInProgress(false);
  }

  return (
    <span className={`flex items-start -mb-2 ${className || ''}`}>
      <Form
        form={form}
        className={
          `inline-block overflow-hidden max-h-14 max-w-xs transition-all duration-700 ${
            showChangeEmailField ? 'opacity-100 w-full mr-2' : 'opacity-0 w-0'
          }`
        }
        requiredMark={false}
        initialValues={changeEmailInitialFormValues}
        onFinish={handleSubmitNewEmail}
      >
        <Form.Item
          name="email"
          rules={[
            {
              required: true,
              message: 'Can not be empty'
            },
            {
              type: 'email',
              message: 'Invalid email format'
            }
          ]}
        >
          <Input type="email" className="w-full min-w-0" />
        </Form.Item>
      </Form>
      <Button
        type="primary"
        size="middle"
        loading={isChangeEmailInProgress}
        htmlType={showChangeEmailField ? 'submit' : 'button'}
        onClick={() => showChangeEmailField
          ? form.submit()
          // ? setShowChangeEmailField(false)
          : setShowChangeEmailField(true)
        }
      >
        {showChangeEmailField ? 'Confirm Email' : 'Change Email' }
      </Button>
    </span>
  );
}

export const ChangeEmailForm = memo(ChangeEmailFormComponent);

