import React, { useEffect, useState } from "react"
import { useServices } from "hooks/useServices"
import { OnboardingTourLazyLoader } from "./OnboardingTourLazyLoader"

export const BACKEND_ONBOARDING_COLLECTION_NAME = "onboarding_tour_completed"

export const OnboardingSwitch = React.memo(() => {
  const services = useServices()
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean>(false)

  useEffect(() => {
    ;(async () => {
      const userCompletedOnboardingTourPreviously = (
        await services.backendApiClient.get(
          `/configurations/${BACKEND_ONBOARDING_COLLECTION_NAME}?id=${services.activeProject.id}`
        )
      ).completed

      if (!userCompletedOnboardingTourPreviously) setOnboardingNeeded(true)
    })()
  }, [])

  return onboardingNeeded ? <OnboardingTourLazyLoader /> : null
})
