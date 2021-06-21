// @Components
import { Button, Spin } from 'antd'
import { useEffect, useRef, useState } from 'react'
// @Services
import ApplicationServices from '@./lib/services/ApplicationServices';
// @Styles
import styles from './OnboardingTourReceiveEvent.module.less'

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

const services = ApplicationServices.get();

const POLLING_INTERVAL_MS = 1000;
const SHOW_SKIP_BUTTON_AFTER_MS = 3000;

export const OnboardingTourReceiveEvent: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  const [skipIsHidden, setSkipIsHidden] = useState<boolean>(true);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    intervalRef.current = window.setInterval(async() => {
      const events = await services.backendApiClient.get(
        `/events/cache?project_id=${services.activeProject.id}&limit=5`, { proxy: true }
      );
      if (events?.total_events) {
        window.clearInterval(intervalRef.current);
        handleGoNext();
      }
    }, POLLING_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalRef.current);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => setSkipIsHidden(false), SHOW_SKIP_BUTTON_AFTER_MS);
  }, [])

  return (<div className={styles.mainContainer}>
    <h1 className={styles.header}>
      {'📡 Listening For Events'}
    </h1>
    <span className={styles.spinnerContainer}>
      <Spin size="large" />
    </span>
    <p className={styles.paragraph}>
      {`Waiting for the events to get registered in Jitsu`}
    </p>
    <div className={styles.controlsContainer}>
      <Button type="ghost" size="large" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back to Instructions'}</Button>
    </div>
    <div className={styles.skipButtonContainer}>
      <Button type="text" hidden={skipIsHidden} className={styles.withButtonsMargins} onClick={handleGoNext}>{'I want to test it later '}</Button>
    </div>
  </div>);
}