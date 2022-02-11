import React from "react"

const OnboardingTour = React.lazy(() => import("./OnboardingTour"))

export const OnboardingTourLazyLoader: React.FC = () => {
  return (
    <React.Suspense fallback={null}>
      <OnboardingTour />
    </React.Suspense>
  )
}
