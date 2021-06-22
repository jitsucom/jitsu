// @Libs
import { useCallback, useMemo, useState } from 'react';
// @Components
import { Button, Form, Input, Switch } from 'antd';
import { BankOutlined, UserOutlined } from '@ant-design/icons';
// @Utils
import { handleError } from 'lib/components/components';
import { randomId } from 'utils/numbers';
// @Types
import { User, Project } from 'lib/services/model';
// @Styles
import styles from './OnboardingTourNames.module.less'
import ApplicationServices from '@./lib/services/ApplicationServices';

type OnboardingTourNamesStepProps = {
   user: User;
   handleGoNext: () => void;
 }

 type OnboardingTourNamesFormValues = {
   userDisplayName?: string;
   projectName?: string;
   emailsOptIn: boolean;
 }

const services = ApplicationServices.get();

export const OnboardingTourNames: React.FC<OnboardingTourNamesStepProps> = function({
  user,
  handleGoNext
}) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [form] = Form.useForm<OnboardingTourNamesFormValues>();

  const initialValues = useMemo<OnboardingTourNamesFormValues>(() => {
    const userProjectName = user.projects?.length ? user.projects[0].name : '';
    const suggestedProjectName = user.suggestedInfo.companyName;
    return ({
      userDisplayName: user.name || user.suggestedInfo.name || '',
      projectName: userProjectName || suggestedProjectName || '',
      emailsOptIn: true
    })
  }, [
    user.name,
    user.projects,
    user.suggestedInfo.name,
    user.suggestedInfo.companyName
  ]);

  const handleSubmit = useCallback(async() => {
    setIsSubmitting(true);
    let values: OnboardingTourNamesFormValues | undefined;
    try {
      values = await form.validateFields();
    } catch (e) {
      //no need for special handling, all errors will be displayed within the form
      setIsSubmitting(false)
      return;
    }
    try {
      // for rare case if user arrived without a project
      if (!user.projects || !user.projects.length) {
        user.projects = [new Project(randomId(5), values.projectName)];
      }
      // user may not have the project name after the sign up
      else if (!user.projects[0].name) {
        user.projects[0].name = values.projectName;
      }
      if (!user.created) {
        user.created = new Date();
      }
      user.name = values.userDisplayName;
      user.emailOptout = !values.emailsOptIn;
      await ApplicationServices.get().userService.update(user);
      handleGoNext();
    } catch (error) {
      handleError(error, "Can't save project data");
      services.analyticsService.track('onboarding_names_error', { error });
    } finally {
      setIsSubmitting(false)
    }
  }, [form, user, handleGoNext, setIsSubmitting])

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'🙌 Getting Known'}
      </h1>
      <p className={styles.paragraph}>
        {'Please tell us more about yourself and your company.'}
      </p>
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
              message: 'Please input your name!'
            }
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
              message: 'Company Name'
            }
          ]}
        >
          <Input size="large" prefix={<BankOutlined className="site-form-item-icon" />} placeholder="Company Name" />
        </Form.Item>
        <Form.Item
          name="emailsOptIn"
          className={styles.onboardingEmailOptInRow}
          valuePropName="checked"
          label={'Send me occasional product updates. You may unsubscribe at any time.'}
        >
          <Switch size="small" />
        </Form.Item>

        <div className={styles.controlsContainer}>
          <Button
            type="primary" size="large" loading={isSubmitting} onClick={handleSubmit}
          >
            {'Submit'}
          </Button>
        </div>
      </Form>
    </div>
  )
}