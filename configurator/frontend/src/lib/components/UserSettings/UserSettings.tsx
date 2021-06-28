import { UserSettingsViewComponent } from './UserSettingsView';

type Props = {}

export const UserSettings: React.FC<Props> = () => {
  return (
    <UserSettingsViewComponent
      currentEmail={{
        value: 'some@email.com',
        isConfirmed: false
      }}
      isTelemetryEnabled={false}
      handleChangeEmail={async() => {}}
      handleSendEmailConfirmation={async() => {}}
      handleChangeTelemetry={async() => {}}
      handleChangePassword={async() => {}}
    />
  );
}