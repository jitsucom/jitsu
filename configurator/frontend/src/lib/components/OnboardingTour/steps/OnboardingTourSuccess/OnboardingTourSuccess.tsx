// @Components
import { Button } from 'antd';

// @styles
import styles from './OnboardingTourSuccess.module.less';

type Props = {
  handleRestartTour?: () => void;
  handleFinishOnboarding: () => void;
 }

export const OnboardingTourSuccess: React.FC<Props> = function({
  handleRestartTour,
  handleFinishOnboarding
}) {
  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'✨ Success!'}
    </h1>
    <p className={styles.paragraph}>
      {'You are all set up and running. Enjoy!'}
    </p>
    <div className={styles.controlsContainer}>
      {handleRestartTour && <Button type="default" size="large" className={styles.withButtonsMargins} onClick={handleRestartTour}>{'Restart Tour'}</Button>}
      <Button type="primary" size="large"  className={styles.withButtonsMargins} onClick={handleFinishOnboarding}>{'Finish'}</Button>
    </div>
  </div>);
}