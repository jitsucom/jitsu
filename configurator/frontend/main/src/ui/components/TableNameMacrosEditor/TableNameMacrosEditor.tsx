import { Button, Modal } from "antd"

export type OnSaveCallback = (text: string) => void

export type TableNameMacrosEditorProps = {
  macros: string
  onSave: OnSaveCallback
}

export function TableNameMacrosEditor(props: TableNameMacrosEditorProps) {
  return (
    <>
      <textarea>{props.macros}</textarea>
      <Button>Save</Button>
    </>
  )
}

/**
 * Opens a modal dialog.
 */
TableNameMacrosEditor.modal = function (macros: string, onSave: OnSaveCallback) {
  Modal.info({})
}
