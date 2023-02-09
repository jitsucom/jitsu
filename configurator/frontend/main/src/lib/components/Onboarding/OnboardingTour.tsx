// @Libs
import React, { useEffect, useMemo, useState } from "react"
import { observer } from "mobx-react-lite"
import { flowResult } from "mobx"
import moment from "moment"
// @Store
import { apiKeysStore } from "stores/apiKeys"
import { destinationsStore } from "stores/destinations"
// @Components
import { Tour, TourStep } from "./Tour/Tour"
import { OnboardingTourGreeting } from "./steps/OnboardingTourGreeting/OnboardingTourGreeting"
import { OnboardingTourNames } from "./steps/OnboardingTourNames/OnboardingTourNames"
import { OnboardingTourAddDestination } from "./steps/OnboardingTourAddDestination/OnboardingTourAddDestination"
import { OnboardingTourAddJitsuOnClient } from "./steps/OnboardingTourAddJitsuOnClient/OnboardingTourAddJitsuOnClient"
import { OnboardingTourReceiveEvent } from "./steps/OnboardingTourReceiveEvent/OnboardingTourReceiveEvent"
import { OnboardingTourSuccess } from "./steps/OnboardingTourSuccess/OnboardingTourSuccess"

// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Hooks
import { formatTimeOfRawUserEvents, getLatestUserEvent, userEventWasTimeAgo } from "lib/commons/utils"
import { Project } from "../../../generated/conf-openapi"
import { ErrorBoundary } from "../ErrorBoundary/ErrorBoundary"

type OnboardingConfig = {
  showDestinationsSetupStep: boolean
  showJitsuClientDocsStep: boolean
  showEventListenerStep: boolean
}

type OnboardingTourProps = { project: Project }

const USER_EVENT_EXPIRATION_THRESHOLD = moment.duration(1, "months")


const OnboardingTourComponent: React.FC<OnboardingTourProps> = ({ project }) => {
  const services = ApplicationServices.get()

  const [config, setConfig] = useState<OnboardingConfig | null>(null)
  const [userClosedTour, setUserClosedTour] = useState<boolean>(false)

  const showTour = useMemo<boolean>(() => {
    return !!config && !userClosedTour
  }, [config, userClosedTour])

  const handleFinishOnboarding = async () => {
    await services.projectService.updateProject(project.id, { requiresSetup: false })
    setUserClosedTour(true)
  }

  const steps = useMemo<TourStep[]>(() => {
    let steps: TourStep[] = []

    if (!config) return []

    // Greeting Step
    const next = steps.length + 1
    steps.push({
      content: ({ goTo }) => {
        return <OnboardingTourGreeting amountOfSteps={calculateAmountOfSteps(config)} handleGoNext={() => goTo(next)} />
      },
    })

    // User and Company Names Step
    {
      const user = services.userService.getUser()
      const next = steps.length + 1
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourNames
              user={user}
              companyName={project.name || user.suggestedCompanyName}
              handleGoNext={() => goTo(next)}
            />
          )
        },
      })
    }

    // Add destinations
    if (config.showDestinationsSetupStep) {
      const next = steps.length + 1
      const removeEventListeningStep = () => {
        setConfig(config => ({
          ...config,
          showEventListenerStep: false,
        }))
      }
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourAddDestination
              handleGoNext={() => goTo(next)}
              handleSkip={() => {
                removeEventListeningStep()
                goTo(next)
              }}
            />
          )
        },
      })
    }

    // Show client docs and wait for the firs event
    if (config.showJitsuClientDocsStep) {
      const next = steps.length + 1
      const prev = steps.length - 1
      const disableGoBack = config.showDestinationsSetupStep
      steps.push({
        content: ({ goTo }) => {
          return (
            <OnboardingTourAddJitsuOnClient
              handleGoNext={() => goTo(next)}
              handleGoBack={disableGoBack ? undefined : () => goTo(prev)}
            />
          )
        },
      })
    }
    if (config.showEventListenerStep) {
      const next = steps.length + 1
      const prev = steps.length - 1
      steps.push({
        content: ({ goTo }) => {
          return <OnboardingTourReceiveEvent handleGoNext={() => goTo(next)} handleGoBack={() => goTo(prev)} />
        },
      })
    }

    // Success Screen
    steps.push({
      content: <OnboardingTourSuccess handleFinishOnboarding={handleFinishOnboarding} />,
    })

    return steps
  }, [config])

  useEffect(() => {
    const initialPrepareConfig = async (): Promise<void> => {
      const [user, destinations, eventsResponse] = await Promise.all([
        services.userService.getUser(),
        destinationsStore.list,
        getEvents(services),
      ])

      // user and company name
      const userName = user.name
      const companyName = project.name

      // destinations
      const _destinations: DestinationData[] = destinations ?? []
      const showDestinationsSetupStep = _destinations.length === 0

      // jitsu client configuration docs and first event detection
      const showJitsuClientDocsStep: boolean = !!eventsResponse ? needShowJitsuClientConfigSteps(eventsResponse) : true

      const needToShowTour = !userName || !companyName || showDestinationsSetupStep || showJitsuClientDocsStep

      if (needToShowTour) {
        flowResult(apiKeysStore.generateAddInitialApiKeyIfNeeded()).then(() => {
          setConfig({
            showDestinationsSetupStep,
            showJitsuClientDocsStep,
            showEventListenerStep: showJitsuClientDocsStep,
          })
        })
      }
    }
    initialPrepareConfig()
  }, [])

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
  )
}

function needShowJitsuClientConfigSteps(rawEvents: unknown): boolean {
  const latestUserEvent = getLatestUserEvent(formatTimeOfRawUserEvents(rawEvents))
  if (!latestUserEvent) return true
  const latestEventWasLongAgo = userEventWasTimeAgo(latestUserEvent, USER_EVENT_EXPIRATION_THRESHOLD)
  return latestEventWasLongAgo
}

function calculateAmountOfSteps(config: OnboardingConfig): number {
  return Object.values(config).reduce((accumulator, current) => {
    return accumulator + +current
  }, 0)
}

async function getEvents(services: ApplicationServices): Promise<any> {
  try {
    await services.backendApiClient.get(`/events/cache?project_id=${services.activeProject.id}&limit=5`, {
      proxy: true,
    })
  } catch (e) {
    return undefined
  }
}

const OnboardingTour: React.FC<OnboardingTourProps> = observer(props => {
  return (
    <ErrorBoundary hideError={true} onAfterErrorOccured={error => console.error(`Onboarding tour error: ${error}`)}>
      <OnboardingTourComponent {...props} />
    </ErrorBoundary>
  )
})

OnboardingTour.displayName = "OnboardingTour"

export { OnboardingTour }

export default OnboardingTour
