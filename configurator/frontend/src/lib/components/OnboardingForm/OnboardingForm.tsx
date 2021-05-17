/* eslint-disable */
import * as React from 'react';
import { Project, SuggestedUserInfo, User } from '../../services/model';
import { Button, Form, Input, Modal, Switch } from 'antd';

import BankOutlined from '@ant-design/icons/lib/icons/BankOutlined';
import UserOutlined from '@ant-design/icons/lib/icons/UserOutlined';

import { useState } from 'react';
import ApplicationServices from '../../services/ApplicationServices';
import * as Utils from '../../commons/utils';
import { reloadPage } from '../../commons/utils';
import { handleError, makeErrorHandler } from '../components';
import './OnboardingForm.less';
import { randomId } from '@util/numbers';

type State = {
  loading: boolean;
};

type Props = {
  user: User;
  onCompleted: () => void;
};

export default function OnboardingForm(props: Props) {
  let services = ApplicationServices.get();
  const [state, setState] = useState({
    loading: false
  });
  const [emailOptout, setEmailOptout] = useState(false);
  const [form] = Form.useForm();

  const onSubmit = async () => {
    setState({ loading: true });

    let values;
    try {
      values = await form.validateFields();
    } catch (e) {
      //no need for special handling, all errors will be displayed within the form
      setState({ loading: false });
      return;
    }
    try {
      let user = services.userService.getUser();

      //send conversion
      services.analyticsService.track('saas_signup', {
        app: services.features.appName,
        user: { email: user.email, id: user.uid }
      }, {
        intercom: (client, eventType, payload) => {

        }
      });

      user.onboarded = true;
      user.projects = [new Project(randomId(5), values['projectName'])];
      if (!user.created) {
        user.created = new Date();
      }
      user.name = values['userDisplayName'];
      user.emailOptout = emailOptout;

      await services.userService.update(user);

      props.onCompleted();
    } catch (e) {
      handleError(e, "Can't save project data");
    } finally {
      setState({ loading: false });
    }
  };
  return (
    <Modal
      title="You're almost done! To finish registration, please tell us more about yourself and your company"
      visible={true}
      closable={false}
      footer={
        <>
          <Button
            key="cancel"
            onClick={() => {
              services.userService.removeAuth(reloadPage);
            }}
          >
            Logout
          </Button>
          <Button
            key="submit"
            type="primary"
            loading={state.loading}
            onClick={() => {
              onSubmit();
            }}
          >
            Submit
          </Button>
        </>
      }
    >
      <Form
        layout="vertical"
        form={form}
        name="onboarding-form"
        className="onboarding-form"
        initialValues={{
          userDisplayName: props.user.suggestedInfo.name,
          projectName: props.user.suggestedInfo.companyName
        }}
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
        <Form.Item name="emailsOptIn" className="signup-checkboxes-email">
          <Switch defaultChecked={true} size="small" onChange={(value) => setEmailOptout(!value)} /> Send me occasional
          product updates. You may unsubscribe at any time.
        </Form.Item>
      </Form>
    </Modal>
  );
}
