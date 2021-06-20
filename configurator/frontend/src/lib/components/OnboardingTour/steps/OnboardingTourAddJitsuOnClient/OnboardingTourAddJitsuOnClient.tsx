// @Libs
import { Button } from 'antd'
// @Components
import { KeyDocumentation } from 'lib/components/ApiKeys/ApiKeys'
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
  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Add Jitsu on Client'}
      </h1>
      <div className={styles.contentContainer}>
        <KeyDocumentation
          token={{
            uid: 'string',
            jsAuth: 'string',
            serverAuth: 'string',
            origins: ['string'],
            comment: 'string'
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