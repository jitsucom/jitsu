// @components
import { Button } from 'antd'

// @styles
import styles from './OnboardingTourAddDestination.module.less'

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

export const OnboardingTourAddDestination: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'Destinations Setup'}
    </h1>
    <p>
      {`Looks like you don't have destinations set up. Let's create one.`}
    </p>
    <div className={styles.controlsContainer}>
      <Button type="ghost" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back'}</Button>
      <Button type="primary" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Next'}</Button>
    </div>
  </div>);
}