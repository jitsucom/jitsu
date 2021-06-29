import { useServices } from '@./hooks/useServices';
import { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { UserSettingsViewComponent } from './UserSettingsView';

type Email = {
  value: string,
  isConfirmed: boolean;
}

type ConfirmationEmailStatus = 'not-required' | 'ready' | 'sending' | 'sent'

type Props = {}

export const UserSettings: React.FC<Props> = () => {
  const services = useServices();
  const user = services.userService.getUser();

  const [isEmailConfirmed, setIsEmailConfirmed] = useState<boolean>(true);
  const [confirmationEmailStatus, setConfirmationEmailStatus] = useState<ConfirmationEmailStatus>('not-required');

  const currentEmail = useMemo<Email>(() => {
    const email = user.email;
    return {
      value: email,
      isConfirmed: isEmailConfirmed
    }
  }, [
    user.email,
    isEmailConfirmed
  ])

  const handleSendEmailConfirmation = async() => {
    setConfirmationEmailStatus('sending');
    try {
      await services.userService.sendConfirmationEmail();
      setConfirmationEmailStatus('sent');
    } catch (error) {
      message.error(`Unable to send verification link: ${error.message || error}`);
      setConfirmationEmailStatus('ready');
    }
  }

  useEffect(() => {
    const getSettings = async() => {
      const email = await services.userService.getUserEmailStatus();
      if (email.needsConfirmation && !email.isConfirmed) {
        setIsEmailConfirmed(email.isConfirmed);
        setConfirmationEmailStatus('ready');
      }
    }
    getSettings();
  }, []);

  return (
    <UserSettingsViewComponent
      currentEmail={currentEmail}
      confirmationEmailStatus={confirmationEmailStatus}
      isTelemetryEnabled={true}
      handleChangeEmail={async() => {}}
      handleSendEmailConfirmation={handleSendEmailConfirmation}
      handleChangePassword={async() => {}}
      handleChangeTelemetry={async() => {}}
    />
  );
}