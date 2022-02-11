import React, { useEffect, useState } from "react"
import { useServices } from "hooks/useServices"
import { OnboardingTourLazyLoader } from "./OnboardingTourLazyLoader"

export const OnboardingSwitch = React.memo(() => {
  const services = useServices()
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean>(false)

  useEffect(() => {
    ;(async () => {
      const userCompletedOnboardingTourPreviously = (
        await services.storageService.get("onboarding_tour_completed", services.activeProject.id)
      ).completed

      if (!userCompletedOnboardingTourPreviously) setOnboardingNeeded(true)
    })()
  }, [])
  return onboardingNeeded ? <OnboardingTourLazyLoader /> : null
})
