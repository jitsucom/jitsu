// @Libs
import React, { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import moment from 'moment';
// @Components
import { Tour, TourStep } from './Tour/Tour';
import { OnboardingTourGreeting } from './steps/OnboardingTourGreeting/OnboardingTourGreeting';
import { OnboardingTourNames } from './steps/OnboardingTourNames/OnboardingTourNames';
import { OnboardingTourAddDestination } from './steps/OnboardingTourAddDestination/OnboardingTourAddDestination';
import { OnboardingTourAddJitsuOnClient } from './steps/OnboardingTourAddJitsuOnClient/OnboardingTourAddJitsuOnClient';
import { OnboardingTourReceiveEvent } from './steps/OnboardingTourReceiveEvent/OnboardingTourReceiveEvent';
import { OnboardingTourSuccess } from './steps/OnboardingTourSuccess/OnboardingTourSuccess';
// @Services
import ApplicationServices from '@./lib/services/ApplicationServices';
// @Hooks
import useLoader from '@./hooks/useLoader';
import { formatTimeOfRawUserEvents, getLatestUserEvent, userEventWasTimeAgo } from '@./lib/commons/utils';
import { fetchUserAPITokens, generateNewAPIToken, UserAPIToken, _unsafeRequestPutUserAPITokens } from '../ApiKeys/ApiKeys';

type OnboardingConfig = {
  showUserAndCompanyNamesStep: boolean;
  showDestinationsSetupStep: boolean;
  showJitsuClientConfigurationSteps: boolean;
}

const USER_EVENT_EXPIRATION_THRESHOLD = moment.duration(1, 'months');

export function showOnboardingError(msg?: string): void {
  message.error(`Onboarding caught error${msg ? ': ' + msg : ''}`)
}

export const OnboardingTour: React.FC = () => {
  const services = ApplicationServices.get();

  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [userClosedTour, setUserClosedTour] = useState<boolean>(false);

  const showTour = useMemo<boolean>(() => {
    return !!config && !userClosedTour;
  }, [config, userClosedTour]);

  const [
    ,
    destinations,,,
    isLoadingDestinations
  ] = useLoader(async() => await services.storageService.get('destinations', services.activeProject.id));

  const [
    ,
    events,,,
    isLoadingEvents
  ] = useLoader<unknown>(
    async() => await services.backendApiClient.get(
      `/events/cache?project_id=${services.activeProject.id}&limit=5`, { proxy: true }
    )
  )

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

    // Add destinations
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

    // Show client docs and wait for the firs event
    if (config.showJitsuClientConfigurationSteps) {
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
      ! isLoadingDestinations &&
      ! isLoadingEvents;

    // user already completed the tour previously
    const userCompletedTheTourPreviously = false;

    // user and company name
    const userName = user?.suggestedInfo.name;
    const companyName = user?.suggestedInfo.companyName;
    const showUserAndCompanyNamesStep = !userName || !companyName;

    // destinations
    const _destinations: DestinationData[] = destinations?.destinations ?? [];
    const showDestinationsSetupStep = _destinations.length === 0;

    // jitsu client configuration docs and first event detection
    const showJitsuClientConfigurationSteps: boolean =
      isLoadingEvents || !events
        ? false
        : needShowJitsuClientConfigSteps(events);

    const needToShowTour =
      showUserAndCompanyNamesStep ||
      showDestinationsSetupStep ||
      showJitsuClientConfigurationSteps

    if (
      !userCompletedTheTourPreviously &&
      configIsReady &&
      needToShowTour &&
      !userClosedTour
    ) {
      generateUserAPIKeyIfNeeded().then(() => {
        setConfig({
          showUserAndCompanyNamesStep,
          showDestinationsSetupStep,
          showJitsuClientConfigurationSteps
        })
      })
    };

  }, [
    services.userService,
    destinations?.destinations,
    isLoadingDestinations,
    events,
    isLoadingEvents,
    userClosedTour
  ]);

  return <Tour
    showTour={showTour}
    steps={steps}
    startAt={0}
    maskClosable={true}
  />
};

function needShowJitsuClientConfigSteps(rawEvents: unknown): boolean {
  const latestUserEvent = getLatestUserEvent(
    formatTimeOfRawUserEvents(rawEvents)
  );
  if (!latestUserEvent) return true;
  const latestEventWasLongAgo = userEventWasTimeAgo(latestUserEvent, USER_EVENT_EXPIRATION_THRESHOLD);
  return latestEventWasLongAgo;
}

async function generateUserAPIKeyIfNeeded(): Promise<void> {
  try {
    const keys = (await fetchUserAPITokens()).keys;
    if (!keys?.length)
      await _unsafeRequestPutUserAPITokens([createFullAPIToken()]);
  } catch (error) {
    showOnboardingError(error.message ?? error);
  }
}

function createFullAPIToken(): UserAPIToken {
  return {
    uid: generateNewAPIToken('', 6),
    serverAuth: generateNewAPIToken('s2s'),
    jsAuth: generateNewAPIToken('js'),
    origins: []
  };
}