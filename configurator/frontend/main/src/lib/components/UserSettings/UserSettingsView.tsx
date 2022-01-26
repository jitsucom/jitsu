// @Libs
import { Button, Card } from "antd"
// @Components
import { ChangeEmailForm } from "./components/ChangeEmailForm/ChangeEmailForm"
import { ChangePasswordForm } from "./components/ChangePasswordForm/ChangePasswordForm"
import { TelemetrySettingsForm } from "./components/TelemetrySettingsForm/TelemetrySettingsForm"
// @Styles
import styles from "./UserSettingsView.module.less"

type Email = {
  value: string
  isConfirmed: boolean
}

type ConfirmationEmailStatus = "not-required" | "ready" | "sending" | "sent"

type Props = {
  currentEmail: Email
  confirmationEmailStatus: ConfirmationEmailStatus
  isTelemetryEnabled: boolean
  handleChangeEmail: (newEmail: string) => Promise<void>
  handleSendEmailConfirmation: () => Promise<void>
  handleChangeTelemetry?: false | ((enabled: boolean) => Promise<void>)
  handleChangePassword: (newPassword: string) => Promise<void>
}

const SectionContainer: React.FC = ({ children }) => {
  return (
    <Card className="flex-auto my-3">
      <div className="flex flex-col">{children}</div>
    </Card>
  )
}

const SectionHeader: React.FC = ({ children }) => {
  return <h3 className="text-2xl">{children}</h3>
}

export const UserSettingsViewComponent: React.FC<Props> = ({
  currentEmail,
  confirmationEmailStatus,
  isTelemetryEnabled,
  handleChangeEmail,
  handleSendEmailConfirmation,
  handleChangeTelemetry,
  handleChangePassword,
}) => {
  const showResendEmailFlow = confirmationEmailStatus !== "not-required"
  const showEmailNotSent = confirmationEmailStatus !== "sent"

  return (
    <div className="flex flex-col">
      <SectionContainer>
        <SectionHeader>Email:</SectionHeader>
        <span className={`${showResendEmailFlow ? "mb-0" : "mb-2"}`}>
          <span className="text-lg font-semibold">{currentEmail.value}</span>
          <span className={`ml-2 font-bold ${styles.warning}`}>{currentEmail.isConfirmed ? null : "Not Verified"}</span>
        </span>
        {showResendEmailFlow && (
          <span className="mb-1">
            {showEmailNotSent ? (
              <Button
                type="link"
                size="middle"
                className="px-0"
                loading={confirmationEmailStatus === "sending"}
                onClick={handleSendEmailConfirmation}
              >
                {"Resend Verification Link"}
              </Button>
            ) : (
              <span className="py-1.5 inline-block box-border">{"👌 Verification Link Sent"}</span>
            )}
          </span>
        )}
        <ChangeEmailForm handleChangeEmail={handleChangeEmail} />
      </SectionContainer>

      <SectionContainer>
        <SectionHeader>Password:</SectionHeader>
        <ChangePasswordForm handleChangePassword={handleChangePassword} />
      </SectionContainer>

      {handleChangeTelemetry && (
        <SectionContainer>
          <SectionHeader>Telemetry:</SectionHeader>
          <TelemetrySettingsForm
            isTelemetryEnabled={isTelemetryEnabled}
            handleChangeTelemetry={handleChangeTelemetry}
          />
        </SectionContainer>
      )}
    </div>
  )
}
