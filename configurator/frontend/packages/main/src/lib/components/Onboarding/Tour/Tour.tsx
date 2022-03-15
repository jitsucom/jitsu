import React, { useMemo, useState } from "react"
// @Components
import { Modal } from "antd"
// @Styles
import styles from "./Tour.module.less"
import { ErrorBoundary } from "lib/components/ErrorBoundary/ErrorBoundary"

type TourStepContentArgs = {
  goTo: (step: number) => void
}

export type TourStep = {
  content: React.ReactNode | ((args: TourStepContentArgs) => React.ReactNode)
}

type Props = {
  showTour?: boolean
  steps: TourStep[]
  startAt?: number
  closable?: boolean
  maskClosable?: boolean
  closeOnEsc?: boolean
  displayStep?: boolean
  displayStepStartOffset?: number
  displayStepEndOffset?: number
}

export const Tour: React.FC<Props> = function ({
  showTour = true,
  steps,
  startAt,
  closable = false,
  maskClosable = false,
  closeOnEsc = false,
  displayStep,
  displayStepStartOffset = 0,
  displayStepEndOffset = 0,
}) {
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(startAt ?? 0)

  const currentStepRender = useMemo<React.ReactNode>(() => {
    if (!steps.length) {
      return null
    }

    const content = steps[currentStepIdx]?.content ?? null

    if (typeof content !== "function") return content
    return content({ goTo: setCurrentStepIdx })
  }, [currentStepIdx, setCurrentStepIdx, steps])

  const firstStepToDisplay = 1
  const amountOfStepsToDisplay = steps.length - displayStepStartOffset - displayStepEndOffset
  const curretStepToDisplay = currentStepIdx + 1 - displayStepStartOffset

  return (
    <Modal
      key="onboardingTourComponent"
      visible={showTour && !!currentStepRender}
      footer={null}
      closable={closable}
      maskClosable={maskClosable}
      width={"80vw"}
      keyboard={closeOnEsc}
      destroyOnClose
    >
      <div className={styles.container}>
        {currentStepRender}
        {displayStep && curretStepToDisplay >= firstStepToDisplay && curretStepToDisplay <= amountOfStepsToDisplay && (
          <div className={styles.stepContainer}>{`Step ${curretStepToDisplay} of ${amountOfStepsToDisplay}`}</div>
        )}
      </div>
    </Modal>
  )
}
