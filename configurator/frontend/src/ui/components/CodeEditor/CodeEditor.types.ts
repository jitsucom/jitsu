export interface Props {
  initialValue?: object | string
  className?: string
  height?: number
  language?: string
  enableLineNumbers?: boolean
  readonly?: boolean
  reRenderEditorOnInitialValueChange?: boolean
  dynamicHeight?: () => number
  handleChange: (value: string) => void
  handlePaste?: () => void
  extraSuggestions?: string
  hotkeysOverrides?: {
    onCmdCtrlEnter?: () => void
    onCmdCtrlI?: () => void
    onCmdCtrlU?: () => void
  }
}
