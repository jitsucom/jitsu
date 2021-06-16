// @Components
import { Button } from 'antd';

// @styles
import styles from './OnboardingTourSuccess.module.less';

type Props = {
   handleFinishOnboarding: () => void;
 }

export const OnboardingTourSuccess: React.FC<Props> = function({
  handleFinishOnboarding
}) {
  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'✅ Success!'}
    </h1>
    <p>
      {'You are all set up and running. Enjoy!'}
    </p>
    <div className={styles.controlsContainer}>
      <Button type="default" className={styles.withButtonsMargins} onClick={handleFinishOnboarding}>{'Restart Tutorial'}</Button>
      <Button type="primary" className={styles.withButtonsMargins}>{'Finish'}</Button>
    </div>
  </div>);
}