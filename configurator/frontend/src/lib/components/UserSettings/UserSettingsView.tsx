import { Button, Input, Switch, Card } from 'antd';
import { useState } from 'react';

import styles from './UserSettingsView.module.less';

type Email = {
  value: string;
  isConfirmed: boolean;
}

type ConfirmationEmailStatus = 'not-required' | 'ready' | 'sending' | 'sent';

type Props = {
  currentEmail: Email;
  confirmationEmailStatus: ConfirmationEmailStatus;
  isTelemetryEnabled: boolean;
  handleChangeEmail: () => Promise<void>;
  handleSendEmailConfirmation: () => Promise<void>;
  handleChangeTelemetry: () => Promise<void>;
  handleChangePassword: () => Promise<void>;
}

const SectionContainer: React.FC = ({ children }) => {
  return (
    <Card className="flex-auto my-3">
      <div className="flex flex-col">
        {children}
      </div>
    </Card>
  );
}

const SectionHeader: React.FC = ({ children }) => {
  return <h3 className="text-2xl">{children}</h3>;
}

export const UserSettingsViewComponent: React.FC<Props> = ({
  currentEmail,
  confirmationEmailStatus,
  isTelemetryEnabled,
  handleChangeEmail,
  handleSendEmailConfirmation,
  handleChangeTelemetry,
  handleChangePassword
}) => {
  const [showChangeEmailField, setShowChangeEmailField] = useState<boolean>(false);
  return (
    <div className="flex flex-col">

      <SectionContainer>
        <SectionHeader>Email:</SectionHeader>
        <span className="mb-2">
          <span className="text-lg font-semibold" >{currentEmail.value}</span>
          <span className={`ml-2 font-bold ${styles.warning}`}>{currentEmail.isConfirmed ? null : 'Not Verified'}</span>
        </span>
        <span className="flex items-center" >
          <span className={
            `inline-block overflow-hidden max-w-xs transition-all duration-700 ${
              showChangeEmailField ? 'opacity-100 w-full mr-2' : 'opacity-0 w-0'
            }`
          }>
            <Input className="w-full min-w-0" />
          </span>
          <Button
            type="primary"
            size="middle"
            onClick={() => setShowChangeEmailField(val => !val)}
          >
            {showChangeEmailField ? 'Confirm Email' : 'Change Email' }
          </Button>
          {
            confirmationEmailStatus === 'not-required'
              ? null
              : confirmationEmailStatus !== 'sent'
                ? (
                  <Button
                    type="text"
                    size="middle"
                    className="ml-2"
                    loading={confirmationEmailStatus === 'sending'}
                    onClick={handleSendEmailConfirmation}
                  >
                    {'Resend Verification Link'}
                  </Button>
                ) : (
                  <span className="ml-2">
                    {'👌 Verification Link Sent'}
                  </span>
                )
          }
        </span>
      </SectionContainer>

      <SectionContainer>
        <SectionHeader>Password:</SectionHeader>
        <span>
          <Button type="primary" size="middle">Change Password</Button>
        </span>
      </SectionContainer>

      <SectionContainer>
        <SectionHeader>Telemetry:</SectionHeader>
        <span className="flex items-center">
          <Switch size="small"/>
          <span className="ml-2">
            {'Allow us to track the application state in order to detect and respond to any issues.'}
          </span>
        </span>
      </SectionContainer>
    </div>
  );
}