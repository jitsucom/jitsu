import React from "react"
import { Project } from "../../../generated/conf-openapi"

const OnboardingTour = React.lazy(() => import("./OnboardingTour"))

export const OnboardingTourLazyLoader: React.FC<{ project: Project }> = ({ project }) => {
  return (
    <React.Suspense fallback={null}>
      <OnboardingTour project={project} />
    </React.Suspense>
  )
}
