// @Libs
import { useEffect, useMemo, useState } from 'react';
import { message, Modal } from 'antd';
// @Icons
import { ExclamationCircleOutlined } from '@ant-design/icons/lib/icons/'
// @View
import { UserSettingsViewComponent } from './UserSettingsView';
// @Utils
import { reloadPage } from '@./lib/commons/utils';
// @Services
import { useServices } from '@./hooks/useServices';

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
  const [isTelemetryEnabled, setIsTelemetryEnabled] = useState<boolean>(false);
  const [confirmationEmailStatus, setConfirmationEmailStatus] = useState<
    ConfirmationEmailStatus
  >('not-required');

  const needToDisplayTelemetrySettings = useMemo<boolean>(() => {
    return services.features.appName !== 'jitsu_cloud';
  }, [services.features.appName])

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

  const handleChangeEmail = async(newEmail: string) => {
    try {
      await services.userService.changeEmail(newEmail);
      reloadPage();
    } catch (error) {
      message.error(error.message || error);
    }
  }

  const handleChangePassword = async(newPassword: string) => {
    try {
      await services.userService.changePassword(newPassword);
      message.success('Password updated');
    } catch (error) {
      message.error(error.message || error);
    }
  }

  const handleChangeTelemetry = async(enabled: boolean) => {
    try {
      await services.userService.changeTelemetrySettings({ isTelemetryEnabled: enabled });
      setIsTelemetryEnabled(enabled);
      message.success('Telemetry preferences updated. Changes will apply after the application reload.', 3);
    } catch (error) {
      message.error(error.message || error);
    }
  }

  useEffect(() => {
    const getEmailSettings = async() => {
      const email = await services.userService.getUserEmailStatus();
      if (email.needsConfirmation && !email.isConfirmed) {
        setIsEmailConfirmed(email.isConfirmed);
        setConfirmationEmailStatus('ready');
      }
    }
    const getTelemetryStatus = async() => {
      const response = await services.backendApiClient.get('/configurations/telemetry?id=global_configuration');
      setIsTelemetryEnabled(!response['disabled']?.['usage']);
    }

    getEmailSettings();
    getTelemetryStatus();
  }, []);

  return (
    <UserSettingsViewComponent
      currentEmail={currentEmail}
      confirmationEmailStatus={confirmationEmailStatus}
      isTelemetryEnabled={isTelemetryEnabled}
      handleChangeEmail={handleChangeEmail}
      handleSendEmailConfirmation={handleSendEmailConfirmation}
      handleChangePassword={handleChangePassword}
      handleChangeTelemetry={needToDisplayTelemetrySettings && handleChangeTelemetry}
    />
  );
}