/* eslint-disable */
import * as React from 'react';
import { Button, Card, Checkbox, Form, message,} from 'antd';
import './SignupForm.less';

import LockOutlined from '@ant-design/icons/lib/icons/LockOutlined';
import MailOutlined from '@ant-design/icons/lib/icons/MailOutlined';

import { NavLink } from 'react-router-dom';
import { reloadPage } from '../../commons/utils';
import ApplicationServices from '../../services/ApplicationServices';
import { handleError } from '../components';
import { FloatingLabelInput } from 'ui/components/FloatingLabelInput/FloatingLabelInput';
import { CheckboxChangeEvent } from 'antd/es/checkbox';

import '../LoginForm/LoginForm.less';

const logo = require('../../../icons/logo.svg').default;

const googleLogo = require('../../../icons/google.svg').default;
const githubLogo = require('../../../icons/github.svg').default;

type State = {
  loading?: boolean;
  tosAgree: boolean;
};

export default class SignupForm extends React.Component<any, State> {
  private services: ApplicationServices;

  constructor(props: any, context: any) {
    super(props, context);
    this.services = ApplicationServices.get();
    this.state = { loading: false, tosAgree: true };
  }

  async trackSignup(email: string, signup_type?: string): Promise<void> {
    return this.services.analyticsService.track('saas_signup', {
      app: this.services.features.appName,
      user: { email: email, signup_type}
    });
  }

  async googleSignup() {
    try{
      const email = await this.services.userService.initiateGoogleLogin();
      await this.trackSignup(email, 'google');
      message.destroy();
      reloadPage()
    } catch (error) {
      message.destroy();
      console.log('Google auth error', error);
      message.error('Google signup is unavailable: ' + error.message);
    }
  }

  async githubSignup() {
    try{
      const email = await this.services.userService.initiateGithubLogin();
      message.destroy();
      await this.trackSignup(email, 'github');
      reloadPage()
    } catch (error) {
      message.destroy();
      console.log('GitHub auth error', error);
      message.error('Github signup is unavailable: ' + error.message);
    }
  }

  async passwordSignup(values) {
    if (!this.state.tosAgree) {
      message.error('To sign up you need to agree to the terms of service');
      return;
    }
    this.setState({ loading: true });
    try {
      await this.services.userService.createUser(values['email'], values['password']);
      await this.trackSignup(values['email']);
      reloadPage();
    } catch (error) {
      handleError(error);
      this.setState({ loading: false });
    }
  }

  private handleChange = (e: CheckboxChangeEvent) => {
    this.setState({ tosAgree: e.target.checked });
  };

  render() {
    if (!this.services.userService.getLoginFeatures().signupEnabled) {
      return <h1 style={{ textAlign: 'center' }}>How did you get here?</h1>;
    }
    let title = (
      <div className="login-form-header-container">
        <img src={logo} alt="[logo]" className="login-form-logo" />
        <div className="login-form-title">Create an account</div>
      </div>
    );
    return (
      <Card
        title={title}
        style={{ margin: 'auto', marginTop: '100px', maxWidth: '500px' }}
        bordered={false}
        className="signup-form-card"
      >
        <Form
          name="signup-form"
          className="signup-form"
          initialValues={{
            remember: false
          }}
          requiredMark={false}
          layout="vertical"
          onFinish={(values) => this.passwordSignup(values)}
        >
          <FloatingLabelInput
            formName="signup-form"
            name="email"
            rules={[
              {
                required: true,
                message: 'Please input your email!'
              },
              { type: 'email', message: 'Invalid email format' }
            ]}
            floatingLabelText="E-mail"
            prefix={<MailOutlined />}
            inputType="email"
          />

          <FloatingLabelInput
            formName="signup-form"
            name="password"
            rules={[
              {
                required: true,
                message: 'Please input your Password!'
              }
            ]}
            floatingLabelText="Password"
            prefix={<LockOutlined />}
            inputType="password"
          />
          <Form.Item name="agreeToTos" className="signup-checkboxes">
            <Checkbox defaultChecked={true} checked={this.state.tosAgree} onChange={this.handleChange}>
              <span>I agree to <a href="https://jitsu.com/tos">Terms of Services</a> and{' '}</span>
              <a href="https://jitsu.com/privacy">Privacy Policy</a>
            </Checkbox>
          </Form.Item>

          <div className="signup-action-buttons">
            <div>
              <Button type="primary" htmlType="submit" className="login-form-button" loading={this.state.loading}>
                Create Account
              </Button>
            </div>
            <div className="signup-divider">Or sign up with:</div>
            <div className="signup-thirdparty">
              <Button
                shape="round"
                icon={<img src={googleLogo} height={16} alt="" />}
                onClick={() => this.googleSignup()}
              >
                Sign up with Google
              </Button>
              <Button
                shape="round"
                icon={<img src={githubLogo} height={16} alt="" />}
                onClick={() => this.githubSignup()}
              >
                Sign up with Github
              </Button>
            </div>
            <div>
              <b>
                <NavLink to="/">Log in</NavLink>
              </b>{' '}
              if you have an account
            </div>
          </div>
        </Form>
      </Card>
    );
  }
}
