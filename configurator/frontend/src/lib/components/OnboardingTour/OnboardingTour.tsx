
// @libraries
import React, { useMemo } from 'react';
import Tour, { ReactourStep } from 'reactour';

// @components
import { OnboardingTourGreeting } from './steps/OnboardingTourGreeting/OnboardingTourGreeting';
import { OnboardingTourNames } from './steps/OnboardingTourNames/OnboardingTourNames';
import { OnboardingTourAddDestination } from './steps/OnboardingTourAddDestination/OnboardingTourAddDestination';
import { OnboardingTourReceiveEvent } from './steps/OnboardingTourReceiveEvent/OnboardingTourReceiveEvent';
import { OnboardingTourSuccess } from './steps/OnboardingTourSuccess/OnboardingTourSuccess';

// @styles
import styles from './OnboardingTour.module.less'

export const OnboardingTour: React.FC = () => {
  const steps = useMemo<ReactourStep[]>(() => {
    return ([
      {
        content: ({ goTo }) => {
          return <OnboardingTourGreeting handleGoNext={() => goTo(1)}/>;
        }
      },
      {
        content: ({ goTo }) => {
          return <OnboardingTourNames handleGoNext={() => goTo(2)}/>;
        }
      },
      {
        content: ({ goTo }) => {
          return <OnboardingTourAddDestination handleGoNext={() => goTo(3)} handleGoBack={() => goTo(1)}/>;
        }
      },
      {
        content: ({ goTo }) => {
          return <OnboardingTourReceiveEvent handleGoNext={() => goTo(4)} handleGoBack={() => goTo(2)}/>;
        }
      },
      {
        content: ({ goTo }) => {
          return <OnboardingTourSuccess handleFinishOnboarding={() => goTo(0)}/>;
        }
      }
    ]);
  }, []);
  return <>
    <Tour
      steps={steps}
      isOpen={true}
      showButtons={false}
      showCloseButton={false}
      showNumber={false}
      showNavigation={false}
      onRequestClose={() => {}}
      className={styles.reactourDialogCard}
    />
  </>;
};

