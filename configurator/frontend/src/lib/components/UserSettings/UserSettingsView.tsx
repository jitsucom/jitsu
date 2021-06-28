import { Modal, Button, Input, Switch, Card } from 'antd';
import { useState } from 'react';

import styles from './UserSettingsView.module.less';

type Email = {
  value: string;
  isConfirmed: boolean;
}

type Props = {
  currentEmail: Email;
  isTelemetryEnabled: boolean;
  handleChangeEmail: () => Promise<void>;
  handleSendEmailConfirmation: () => Promise<void>;
  handleChangeTelemetry: () => Promise<void>;
  handleChangePassword: () => Promise<void>;
}

const _SectionContainer: React.FC = ({ children }) => {
  return <div className="flex flex-col flex-auto my-3">{children}</div>;
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
  isTelemetryEnabled,
  handleChangeEmail,
  handleSendEmailConfirmation,
  handleChangeTelemetry,
  handleChangePassword
}) => {
  const [showChangeEmailField, setShowChangeEmailField] = useState<boolean>(false);
  return (
    // <Modal
    //   // visible
    //   closable
    //   footer={null}
    //   centered
    // >
    <div className="flex flex-col">

      <SectionContainer>
        <SectionHeader>Email:</SectionHeader>
        <span className="mb-2">
          <span className="text-lg font-semibold" >{currentEmail.value}</span>
          <span className={`ml-2 font-bold ${styles.warning}`}>{currentEmail.isConfirmed ? null : 'Not Verified'}</span>
        </span>
        <span className="flex" >
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
          <Button
            type="text"
            size="middle"
            className="ml-2"
          >
            {'Resend Verification Link'}
          </Button>
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
        <span>
          <Switch size="small"/>
        </span>
      </SectionContainer>
    </div>
    // </Modal>
  );
}