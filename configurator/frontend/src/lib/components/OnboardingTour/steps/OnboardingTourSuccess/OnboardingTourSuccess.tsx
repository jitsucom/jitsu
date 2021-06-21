// @Components
import { Button } from 'antd';
// @Services
import ApplicationServices from '@./lib/services/ApplicationServices';
// @styles
import styles from './OnboardingTourSuccess.module.less';

type Props = {
  handleRestartTour?: () => void;
  handleFinishOnboarding: () => void;
}

const services = ApplicationServices.get();

export const OnboardingTourSuccess: React.FC<Props> = function({
  handleRestartTour,
  handleFinishOnboarding
}) {
  const handleClickFinish = (): void => {
    services.analyticsService.track('onboarding_finished');
    handleFinishOnboarding();
  }
  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'✨ Success!'}
    </h1>
    <p className={styles.paragraph}>
      {'You are all set up and running. Enjoy!'}
    </p>
    <div className={styles.controlsContainer}>
      {handleRestartTour && <Button type="default" size="large" className={styles.withButtonsMargins} onClick={handleRestartTour}>{'Restart Tour'}</Button>}
      <Button type="primary" size="large"  className={styles.withButtonsMargins} onClick={handleClickFinish}>{'Finish'}</Button>
    </div>
  </div>);
}