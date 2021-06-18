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
    <p>
      {'You are all set up and running. Enjoy!'}
    </p>
    <div className={styles.controlsContainer}>
      {handleRestartTour && <Button type="default" className={styles.withButtonsMargins} onClick={handleRestartTour}>{'Restart Tour'}</Button>}
      <Button type="primary" className={styles.withButtonsMargins} onClick={handleFinishOnboarding}>{'Finish'}</Button>
    </div>
  </div>);
}