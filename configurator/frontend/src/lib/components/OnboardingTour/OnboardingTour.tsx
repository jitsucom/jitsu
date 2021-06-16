
// @libraries
import React, { useEffect, useMemo, useState } from 'react';
import Tour, { ReactourStep } from 'reactour';

// @components
import { OnboardingTourGreeting } from './steps/OnboardingTourGreeting/OnboardingTourGreeting';
import { OnboardingTourNames } from './steps/OnboardingTourNames/OnboardingTourNames';
import { OnboardingTourAddDestination } from './steps/OnboardingTourAddDestination/OnboardingTourAddDestination';
import { OnboardingTourReceiveEvent } from './steps/OnboardingTourReceiveEvent/OnboardingTourReceiveEvent';
import { OnboardingTourSuccess } from './steps/OnboardingTourSuccess/OnboardingTourSuccess';

// @services
import ApplicationServices from '@./lib/services/ApplicationServices';

// @Hooks
import useLoader from '@./hooks/useLoader';

// @Styles
import styles from './OnboardingTour.module.less'

type OnboardingConfig = {
  showUserAndCompanyNamesStep: boolean;
  showDestinationsSetupSteps: boolean;
}

export const OnboardingTour: React.FC = () => {
  // const services = ApplicationServices.get();

  const [showTour, setShowTour] = useState<boolean>(false)

  // const [sourcesError, sourcesData, updateSources] = useLoader(async() => await services.storageService.get('sources', services.activeProject.id));
  // const [destinationsError, destinations, updateDestinations] = useLoader(async() => await services.storageService.get('destinations', services.activeProject.id));

  const config = useMemo<OnboardingConfig>(() => ({
    showUserAndCompanyNamesStep: true,
    showDestinationsSetupSteps: true
  }), [])

  const steps = useMemo<ReactourStep[]>(() => {
    let steps: ReactourStep[] = [];

    // Greeting Step
    const next = steps.length + 1;
    steps.push({
      content: ({ goTo }) => {
        return <OnboardingTourGreeting handleGoNext={() => goTo(next) }/>;
      }
    })

    // User and Company Names Step
    if (config.showUserAndCompanyNamesStep) {
      const next = steps.length + 1;
      steps.push({
        content: ({ goTo }) => {
          return <OnboardingTourNames handleGoNext={() => goTo(next)}/>;
        }
      })
    }

    // Add Destinations and Test Events
    if (config.showDestinationsSetupSteps) {
      const next = steps.length + 1;
      const prev = steps.length - 1;
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourAddDestination
              handleGoNext={() => goTo(next)}
              handleGoBack={() => goTo(prev)}
            />
          );
        }
      })
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourReceiveEvent
              handleGoNext={() => goTo(next + 1)}
              handleGoBack={() => goTo(prev + 1)}
            />
          );
        }
      })
    }

    // Success Screen
    steps.push({
      content: ({ goTo }) => {
        return <OnboardingTourSuccess handleFinishOnboarding={() => goTo(0)}/>;
      }
    })

    return steps;
  }, [config.showUserAndCompanyNamesStep, config.showDestinationsSetupSteps]);

  useEffect(() => {
    const show = config.showUserAndCompanyNamesStep || config.showDestinationsSetupSteps
    setShowTour(show);
  }, [config.showUserAndCompanyNamesStep, config.showDestinationsSetupSteps])

  return <>
    <Tour
      steps={steps}
      isOpen={showTour}
      showButtons={false}
      closeWithMask={false}
      // showCloseButton={false}
      showNumber={false}
      showNavigation={false}
      onRequestClose={() => setShowTour(false)}
      className={styles.reactourDialogCard}
    />
  </>;
};

