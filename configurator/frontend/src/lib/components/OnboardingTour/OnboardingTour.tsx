// @Libs
import React, { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { flowResult } from 'mobx';
import { message } from 'antd';
import moment from 'moment';
// @Store
import { apiKeysStore } from 'stores/apiKeys';
// @Components
import { Tour, TourStep } from './Tour/Tour';
import { OnboardingTourGreeting } from './steps/OnboardingTourGreeting/OnboardingTourGreeting';
import { OnboardingTourNames } from './steps/OnboardingTourNames/OnboardingTourNames';
import { OnboardingTourAddDestination } from './steps/OnboardingTourAddDestination/OnboardingTourAddDestination';
import { OnboardingTourAddJitsuOnClient } from './steps/OnboardingTourAddJitsuOnClient/OnboardingTourAddJitsuOnClient';
import { OnboardingTourReceiveEvent } from './steps/OnboardingTourReceiveEvent/OnboardingTourReceiveEvent';
import { OnboardingTourSuccess } from './steps/OnboardingTourSuccess/OnboardingTourSuccess';

// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Hooks
import {
  formatTimeOfRawUserEvents,
  getLatestUserEvent,
  userEventWasTimeAgo
} from 'lib/commons/utils';
import { Project } from 'lib/services/model';
import { randomId } from 'utils/numbers';

type OnboardingConfig = {
  showUserAndCompanyNamesStep: boolean;
  showDestinationsSetupStep: boolean;
  showJitsuClientDocsStep: boolean;
  showEventListenerStep: boolean;
}

const USER_EVENT_EXPIRATION_THRESHOLD = moment.duration(1, 'months');

export function showOnboardingError(msg?: string): void {
  message.error(`Onboarding caught error${msg ? ': ' + msg : ''}`)
}

const services = ApplicationServices.get();

const OnboardingTour: React.FC = () => {
  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [userClosedTour, setUserClosedTour] = useState<boolean>(false);

  const showTour = useMemo<boolean>(() => {
    return !!config && !userClosedTour;
  }, [config, userClosedTour]);

  const handleCloseTour = () => {
    setUserClosedTour(true);
  };

  const steps = useMemo<TourStep[]>(() => {
    let steps: TourStep[] = [];

    if (!config) return [];

    // Greeting Step
    const next = steps.length + 1;
    steps.push({
      content: ({ goTo }) => {
        return (
          <OnboardingTourGreeting
            amountOfSteps={calculateAmountOfSteps(config)}
            handleGoNext={() => goTo(next)}
          />
        );
      }
    });

    // User and Company Names Step
    if (config.showUserAndCompanyNamesStep) {
      const user = services.userService.getUser();
      const next = steps.length + 1;
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourNames user={user} handleGoNext={() => goTo(next)} />
          );
        }
      });
    }

    // Add destinations
    if (config.showDestinationsSetupStep) {
      const next = steps.length + 1;
      const removeEventListeningStep = () => {
        setConfig((config) => ({
          ...config,
          showEventListenerStep: false
        }));
      };
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourAddDestination
              handleGoNext={() => goTo(next)}
              handleSkip={() => {
                removeEventListeningStep();
                goTo(next);
              }}
            />
          );
        }
      });
    }

    // Show client docs and wait for the firs event
    if (config.showJitsuClientDocsStep) {
      const next = steps.length + 1;
      const prev = steps.length - 1;
      const disableGoBack = config.showDestinationsSetupStep;
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourAddJitsuOnClient
              handleGoNext={() => goTo(next)}
              handleGoBack={disableGoBack ? undefined : () => goTo(prev)}
            />
          );
        }
      });
    }
    if (config.showEventListenerStep) {
      const next = steps.length + 1;
      const prev = steps.length - 1;
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourReceiveEvent
              handleGoNext={() => goTo(next)}
              handleGoBack={() => goTo(prev)}
            />
          );
        }
      });
    }

    // Success Screen
    steps.push({
      content: ({ goTo }) => {
        return (
          <OnboardingTourSuccess handleFinishOnboarding={handleCloseTour} />
        );
      }
    });

    return steps;
  }, [config]);

  useEffect(() => {
    const initialPrepareConfig = async (): Promise<void> => {
      // temporary hack - project is not created after sign ups with google/github
      if (!services.activeProject) {
        const user = services.userService.getUser();
        user.projects = [new Project(randomId(), null)];
        await services.userService.update(user);
      }

      const userCompletedOnboardingTourPreviously = (
        await services.storageService.get(
          'onboarding_tour_completed',
          services.activeProject.id
        )
      ).completed;

      if (userCompletedOnboardingTourPreviously) return;

      const [user, destinations, events] = await Promise.all([
        services.userService.getUser(),
        services.storageService.get('destinations', services.activeProject.id),
        services.backendApiClient.get(
          `/events/cache?project_id=${services.activeProject.id}&limit=5`,
          { proxy: true }
        )
      ]);

      // user and company name
      const userName = user?.name;
      const companyName = user?.projects?.length ? user?.projects[0]?.name : '';
      const showUserAndCompanyNamesStep = !userName || !companyName;

      // destinations
      const _destinations: DestinationData[] = destinations?.destinations ?? [];
      const showDestinationsSetupStep = _destinations.length === 0;

      // jitsu client configuration docs and first event detection
      const showJitsuClientDocsStep: boolean = !events
        ? false
        : needShowJitsuClientConfigSteps(events);

      const needToShowTour =
        showUserAndCompanyNamesStep ||
        showDestinationsSetupStep ||
        showJitsuClientDocsStep;

      if (needToShowTour) {
        flowResult(apiKeysStore.generateAddInitialApiKeyIfNeeded()).then(() => {
          setConfig({
            showUserAndCompanyNamesStep,
            showDestinationsSetupStep,
            showJitsuClientDocsStep,
            showEventListenerStep: showJitsuClientDocsStep
          });
        });
      }
    };
    initialPrepareConfig();
  }, []);

  return (
    <Tour
      showTour={showTour}
      steps={steps}
      startAt={0}
      maskClosable={true}
      displayStep
      displayStepStartOffset={1}
      displayStepEndOffset={1}
    />
  );
};

function needShowJitsuClientConfigSteps(rawEvents: unknown): boolean {
  const latestUserEvent = getLatestUserEvent(
    formatTimeOfRawUserEvents(rawEvents)
  );
  if (!latestUserEvent) return true;
  const latestEventWasLongAgo = userEventWasTimeAgo(latestUserEvent, USER_EVENT_EXPIRATION_THRESHOLD);
  return latestEventWasLongAgo;
}

function calculateAmountOfSteps(config: OnboardingConfig): number {
  return Object
    .values(config)
    .reduce((accumulator, current) => {
      return accumulator + +current;
    }, 0);
}

OnboardingTour.displayName = 'OnboardingTour';

export { OnboardingTour };