// @Libs
import { Button } from 'antd'
import { useEffect, useState } from 'react'
// @Services
import ApplicationServices from '@./lib/services/ApplicationServices'
// @Components
import { OnboardingClientDocs } from './OnboardingClientDocs'
// @Helpers
import ApiKeyHelper from '@./lib/services/ApiKeyHelper'
import { showOnboardingError } from '../../OnboardingTour'
// @Styles
import styles from './OnboardingTourAddJitsuOnClient.module.less'

type Props = {
   handleGoNext: () => void;
   handleGoBack?: () => void;
 }

export const OnboardingTourAddJitsuOnClient: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  const [apiKey, setApiKey] = useState<APIKey | null>(null);

  useEffect(() => {
    const getLinkedApiKey = async(): Promise<void> => {
      const services = ApplicationServices.get();
      const helper = new ApiKeyHelper(services);

      await helper.init();

      const linkedKey = await helper.findFirstLinkedKey();
      if (linkedKey) setApiKey(linkedKey);

      let unlinkedKey = helper.keys[0];
      if (!unlinkedKey) unlinkedKey = await helper.createNewAPIKey();

      // at this point, all destinations can only be unlinked (or null)
      const unlinkedDestination = helper.destinations[0];
      if (!unlinkedDestination) {
        // error - user can not arrive here without destinations
        showOnboardingError(`user should have at least one destination`);
        return;
      }

      await helper.linkKeyToDestination(unlinkedKey, unlinkedDestination);
      setApiKey(unlinkedKey);
    }

    getLinkedApiKey();
  }, []);

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'🖥 Add Jitsu on Client'}
      </h1>
      <div className={styles.contentContainer}>
        <OnboardingClientDocs
          token={apiKey || {
            uid: 'loading...',
            jsAuth: 'loading...',
            serverAuth: 'loading...',
            origins: ['loading...'],
            comment: 'loading...'
          }}
        />
      </div>
      <div className={styles.controlsContainer}>
        {!!handleGoBack && <Button type="ghost" size="large" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back'}</Button>}
        <Button type="primary" size="large" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Got it'}</Button>
      </div>
    </div>
  );
}