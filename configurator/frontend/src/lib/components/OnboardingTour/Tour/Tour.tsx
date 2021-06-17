import { Modal } from 'antd'
import React, { useMemo, useState } from 'react'

type TourStepContentArgs = {
  goTo: (step: number) => void;
}

export type TourStep = {
  content: React.ReactNode | ((args: TourStepContentArgs) => React.ReactNode)
}

type Props = {
  showTour?: boolean;
  steps: TourStep[];
  closable?: boolean;
  maskClosable?: boolean;
  closeOnEsc?: boolean;
}

export const Tour: React.FC<Props> = function({
  showTour = true,
  steps,
  closable = false,
  maskClosable = false,
  closeOnEsc = false
}) {
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);

  const currentStepRender = useMemo<React.ReactNode>(() => {
    const content = steps[currentStepIdx].content;
    if (typeof content !== 'function') return content;
    return content({ goTo: setCurrentStepIdx })
  }, [currentStepIdx, setCurrentStepIdx, steps])

  return (
    <Modal
      visible={showTour}
      footer={null}
      closable={closable}
      maskClosable={maskClosable}
      keyboard={closeOnEsc}
      destroyOnClose
    >
      {currentStepRender}
    </Modal>
  );
}