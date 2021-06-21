// @Components
import { Button } from 'antd';

// @styles
import styles from './OnboardingTourGreeting.module.less';

type Props = {
   handleGoNext: () => void;
 }

export const OnboardingTourGreeting: React.FC<Props> = function({
  handleGoNext
}) {
  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'👋 Welcome to Jitsu!\n'}
    </h1>
    <p className={styles.paragraph}>
      {'Use this guide to configure your project in three simple steps.'}
    </p>
    <div className={styles.controlsContainer}>
      <Button type="primary" size="large" onClick={handleGoNext}>{'Next'}</Button>
    </div>
  </div>);
}