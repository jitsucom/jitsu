// @Libs
import useLoader from '@./hooks/useLoader'
import { Button } from 'antd'
// @Components
import { fetchUserAPITokens, KeyDocumentation, UserAPIToken } from 'lib/components/ApiKeys/ApiKeys'
import { useMemo } from 'react'
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
  const [
    ,
    apiKeys,,,
  ] = useLoader(async() => (await fetchUserAPITokens()).keys);

  const key = useMemo<UserAPIToken | null>(() => {
    return apiKeys?.length ? apiKeys[0] : null;
  }, [apiKeys]);

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Add Jitsu on Client'}
      </h1>
      <div className={styles.contentContainer}>
        <KeyDocumentation
          token={key || {
            uid: '<your API key>',
            jsAuth: '<your API key>',
            serverAuth: '<your API key>',
            origins: ['<your API key>'],
            comment: '<your API key>'
          }}
          displayDomainDropdown={false}
        />
      </div>
      <div className={styles.controlsContainer}>
        {!!handleGoBack && <Button type="ghost" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back'}</Button>}
        <Button type="primary" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Got it'}</Button>
      </div>
    </div>
  );
}