// @Libs
import { Modal, ModalProps } from "antd"
// @Component
import { CodeDebugger, CodeDebuggerProps } from "../CodeDebugger/CodeDebugger"
// @Styles
import styles from "./CodeDebuggerModal.module.less"

type DebuggerProps = {
  [P in keyof CodeDebuggerProps & string as `${P}Debugger`]: CodeDebuggerProps[P]
}

type Props = Partial<DebuggerProps> & ModalProps

/**
 * Decorates code debugger with an antd almost-full-height/width modal.
 * Accepts antd Modal props and CodeDebugger props if they are postfixed with `Debugger`.
 */
export const CodeDebuggerModal: React.FC<Props> = ({
  classNameDebugger,
  codeFieldLabelDebugger,
  defaultCodeValueDebugger,
  handleCloseDebugger,
  handleCodeChangeDebugger,
  runDebugger = () => {},
  handleSaveCodeDebugger,
  extraSuggestionsDebugger,
  className: modalClassName,
  centered: modalCentered,
  width: modalWidth,
  closable: modalClosable,
  maskClosable: modalMaskClosable,
  ...modalProps
}) => {
  return (
    <Modal
      centered
      footer={null}
      closable={false}
      maskClosable={true}
      className={`${styles.modal} ${modalClassName}`}
      {...modalProps}
    >
      <CodeDebugger
        className={classNameDebugger}
        codeFieldLabel={codeFieldLabelDebugger}
        defaultCodeValue={defaultCodeValueDebugger}
        handleClose={handleCloseDebugger}
        handleCodeChange={handleCodeChangeDebugger}
        handleSaveCode={handleSaveCodeDebugger}
        run={runDebugger}
        extraSuggestions={extraSuggestionsDebugger}
      />
    </Modal>
  )
}
