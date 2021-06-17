// @components
import { Button, Spin } from 'antd'

// @styles
import styles from './OnboardingTourReceiveEvent.module.less'

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

export const OnboardingTourReceiveEvent: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'Test Your Setup'}
    </h1>
    <span className={styles.spinnerContainer}>
      <Spin />
    </span>
    <p>
      {`Waiting for the events to get registered in Jitsu`}
    </p>
    <div className={styles.controlsContainer}>
      <Button type="text" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Skip Verification'}</Button>
      <Button type="ghost" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back to Instructions'}</Button>
      {/* <Button type="primary" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Next'}</Button> */}
    </div>
  </div>);
}