// @libs
import { Button } from 'antd'

// @styles
import styles from './OnboardingTourAddJitsuOnClient.module.less'

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

export const OnboardingTourAddJitsuOnClient: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Add Jitsu on Client'}
      </h1>
      <p>
        {`Setting up Jitsu in client is extremely easy! ...`}
      </p>
      <div className={styles.controlsContainer}>
        <Button type="ghost" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back'}</Button>
        <Button type="primary" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Got it'}</Button>
      </div>
    </div>
  );
}