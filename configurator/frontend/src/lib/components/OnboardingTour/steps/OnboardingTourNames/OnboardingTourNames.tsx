// @libs
import { useMemo } from 'react';

// @components
import { Button, Form, Input } from 'antd';
import { BankOutlined, UserOutlined } from '@ant-design/icons';

// @types
import { User } from '@./lib/services/model';

// @styles
import styles from './OnboardingTourNames.module.less'

type OnboardingTourNamesStepProps = {
   user?: User;
   handleGoNext: () => void;
 }

 type OnboardingTourNamesFormValues = {
   userDisplayName?: string;
   projectName?: string;
 }

export const OnboardingTourNames: React.FC<OnboardingTourNamesStepProps> = function({
  user,
  handleGoNext
}) {
  const initialValues: OnboardingTourNamesFormValues = {
    userDisplayName: '',
    projectName: ''
  }
  // const initialValues = useMemo<OnboardingTourNamesFormValues>(() => ({
  //   userDisplayName: user.suggestedInfo.name,
  //   projectName: user.suggestedInfo.companyName
  // }), [user.suggestedInfo.name, user.suggestedInfo.companyName]);
  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Introduce Yourself'}
      </h1>
      <p>
        {'Please tell us more about yourself and your company.'}
      </p>
      <Form
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
          <Input prefix={<UserOutlined className="site-form-item-icon" />} placeholder="Your Name" />
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
          <Input prefix={<BankOutlined className="site-form-item-icon" />} placeholder="Company Name" />
        </Form.Item>
        {/* <Form.Item name="emailsOptIn" className="signup-checkboxes-email">
       <Switch defaultChecked={true} size="small" onChange={(value) => setEmailOptout(!value)} /> Send me occasional
       product updates. You may unsubscribe at any time.
     </Form.Item> */}
        <div className={styles.controlsContainer}>
          <Button type="primary" onClick={handleGoNext}>{'Submit'}</Button>
        </div>
      </Form>
    </div>
  )
}