// @libraries
import React, { useEffect, useMemo, useState } from 'react';
// @components
import { Tour, TourStep } from './Tour/Tour';
import { OnboardingTourGreeting } from './steps/OnboardingTourGreeting/OnboardingTourGreeting';
import { OnboardingTourNames } from './steps/OnboardingTourNames/OnboardingTourNames';
import { OnboardingTourAddDestination } from './steps/OnboardingTourAddDestination/OnboardingTourAddDestination';
import { OnboardingTourAddJitsuOnClient } from './steps/OnboardingTourAddJitsuOnClient/OnboardingTourAddJitsuOnClient';
import { OnboardingTourReceiveEvent } from './steps/OnboardingTourReceiveEvent/OnboardingTourReceiveEvent';
import { OnboardingTourSuccess } from './steps/OnboardingTourSuccess/OnboardingTourSuccess';
// @services
import ApplicationServices from '@./lib/services/ApplicationServices';
// @Hooks
import useLoader from '@./hooks/useLoader';

type OnboardingConfig = {
  showUserAndCompanyNamesStep: boolean;
  showDestinationsSetupStep: boolean;
  showJitsuConfigurationSteps: boolean;
}

export const OnboardingTour: React.FC = () => {
  const services = ApplicationServices.get();

  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [userClosedTour, setUserClosedTour] = useState<boolean>(false);

  const showTour = useMemo<boolean>(() => {
    return !!config && !userClosedTour;
  }, [config, userClosedTour]);

  const [
    ,destinations,,,
    isLoadingDestinations
  ] = useLoader(async() => await services.storageService.get('destinations', services.activeProject.id));

  const handleCloseTour = () => {
    setUserClosedTour(true);
  }

  const steps = useMemo<TourStep[]>(() => {
    let steps: TourStep[] = [];

    if (!config) return [];

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
    if (config.showDestinationsSetupStep) {
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
    }

    if (config.showJitsuConfigurationSteps) {
      const next = steps.length + 1;
      const prev = steps.length - 1;
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourAddJitsuOnClient
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
        return (
          <OnboardingTourSuccess
            handleRestartTour={() => goTo(1)}
            handleFinishOnboarding={handleCloseTour}
          />
        );
      }
    })

    return steps;
  }, [config]);

  useEffect(() => {
    const user = services.userService.getUser();

    const configIsReady =
      !!user &&
      !!destinations?.destinations;

    // user already completed the tour previously
    const userCompletedTheTourPreviously = false;

    // user and company name
    const userName = user?.suggestedInfo.name;
    const companyName = user?.suggestedInfo.companyName;
    const showUserAndCompanyNamesStep = !userName || !companyName;

    // destinations
    const _destinations: DestinationData[] = destinations?.destinations ?? [];
    const showDestinationsSetupStep = _destinations.length === 0;

    // jitsu client configuration docs
    const showJitsuConfigurationSteps = true;

    const needToShowTour =
      showUserAndCompanyNamesStep ||
      showDestinationsSetupStep ||
      showJitsuConfigurationSteps

    if (
      !userCompletedTheTourPreviously &&
      configIsReady &&
      needToShowTour &&
      !userClosedTour
    ) {
      setConfig({
        showUserAndCompanyNamesStep,
        showDestinationsSetupStep,
        showJitsuConfigurationSteps
      })
    };

  }, [
    services.userService,
    destinations?.destinations,
    isLoadingDestinations,
    userClosedTour
  ]);

  return <Tour
    showTour={showTour}
    steps={steps}
    startAt={0}
    maskClosable={true}
  />
};

