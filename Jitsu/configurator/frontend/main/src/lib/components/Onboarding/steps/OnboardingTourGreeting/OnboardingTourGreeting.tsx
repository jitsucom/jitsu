// @Components
import ApplicationServices from "lib/services/ApplicationServices"
import { Button } from "antd"
// @styles
import styles from "./OnboardingTourGreeting.module.less"
import { reloadPage } from "../../../../commons/utils"
import { Settings } from "../../../../services/UserSettingsService"

type Props = {
  amountOfSteps: number
  handleGoNext: () => void
}

const services = ApplicationServices.get()

const numAmountToString = (num: number): string => {
  switch (num) {
    case 1:
      return " just one simple step"
    case 2:
      return " two simple steps"
    case 3:
      return " three simple steps"
    case 4:
      return " four simple steps"
    default:
      return ""
  }
}

export const OnboardingTourGreeting: React.FC<Props> = function ({ amountOfSteps, handleGoNext }) {
  const handleClickNext = (): void => {
    services.analyticsService.track("onboarding_started")
    handleGoNext()
  }

  const handleClickLogout = (): void => {
    services.userSettingsService.remove(Settings.ActiveProject)
    services.userService.removeAuth(reloadPage)
  }

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>{"👋 Welcome to Jitsu!\n"}</h1>
      <p className={styles.paragraph}>
        {`Use this guide to configure your project in${numAmountToString(amountOfSteps)}.`}
      </p>
      <div className={styles.controlsContainer}>
        <Button type="primary" size="large" onClick={handleClickNext}>
          {"Start"}
        </Button>
      </div>
      <a className={styles.logoutLink} onClick={handleClickLogout}>
        Logout
      </a>
    </div>
  )
}
