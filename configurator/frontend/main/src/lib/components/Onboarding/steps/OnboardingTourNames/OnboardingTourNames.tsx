// @Libs
import { useCallback, useMemo, useState } from "react"
// @Components
import { Button, Form, Input, Switch } from "antd"
import { BankOutlined, UserOutlined } from "@ant-design/icons"
// @Utils
import { handleError } from "lib/components/components"
import { randomId } from "utils/numbers"
// @Styles
import styles from "./OnboardingTourNames.module.less"
import ApplicationServices from "lib/services/ApplicationServices"
import { useServices } from "../../../../../hooks/useServices"
import { User } from "../../../../../generated/conf-openapi"

type OnboardingTourNamesStepProps = {
  user: User
  companyName: string | null | undefined
  handleGoNext: () => void
}

type OnboardingTourNamesFormValues = {
  userDisplayName?: string
  projectName?: string
  emailsOptIn: boolean
}

export const OnboardingTourNames: React.FC<OnboardingTourNamesStepProps> = function ({
  user,
  companyName,
  handleGoNext,
}) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [form] = Form.useForm<OnboardingTourNamesFormValues>()

  const initialValues = useMemo<OnboardingTourNamesFormValues>(() => {
    return {
      userDisplayName: user.name,
      projectName: companyName,
      emailsOptIn: true,
    }
  }, [user.name, companyName])
  const services = useServices()

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true)
    let values: OnboardingTourNamesFormValues | undefined
    try {
      values = await form.validateFields()
    } catch (e) {
      //no need for special handling, all errors will be displayed within the form
      setIsSubmitting(false)
      return
    }
    try {
      // for rare case if user arrived without a project
      user.name = values.userDisplayName
      user.emailOptout = !values.emailsOptIn
      await services.storageService.saveUserInfo({ _emailOptout: !values.emailsOptIn, _name: values.userDisplayName })
      await services.projectService.updateProject(services.activeProject.id, { name: values.projectName })

      handleGoNext()
    } catch (error) {
      handleError(error, "Can't save project data")
      services.analyticsService.track("onboarding_names_error", { error })
    } finally {
      setIsSubmitting(false)
    }
  }, [form, user, handleGoNext, setIsSubmitting])

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>{"🙌 Getting Known"}</h1>
      <p className={styles.paragraph}>{"Please tell us more about yourself and your company."}</p>
      <Form
        form={form}
        layout="vertical"
        name="onboarding-form"
        className="onboarding-form"
        initialValues={initialValues}
      >
        <Form.Item
          name="userDisplayName"
          rules={[
            {
              required: true,
              message: "Please input your name!",
            },
          ]}
        >
          <Input
            autoFocus
            size="large"
            placeholder="Your Name"
            prefix={<UserOutlined className="site-form-item-icon" />}
          />
        </Form.Item>
        <Form.Item
          className="onboarding-form-company name"
          name="projectName"
          rules={[
            {
              required: true,
              message: "Company Name",
            },
          ]}
        >
          <Input size="large" prefix={<BankOutlined className="site-form-item-icon" />} placeholder="Company Name" />
        </Form.Item>
        <Form.Item
          name="emailsOptIn"
          className={styles.onboardingEmailOptInRow}
          valuePropName="checked"
          label={"Send me occasional product updates. You may unsubscribe at any time."}
        >
          <Switch size="small" />
        </Form.Item>

        <div className={styles.controlsContainer}>
          <Button type="primary" size="large" loading={isSubmitting} onClick={handleSubmit}>
            {"Submit"}
          </Button>
        </div>
      </Form>
    </div>
  )
}
