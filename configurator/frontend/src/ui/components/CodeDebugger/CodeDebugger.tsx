// @Libs
import React, { memo, useCallback, useEffect, useState } from "react"
import { ReflexContainer, ReflexSplitter, ReflexElement } from "react-reflex"
import { Button, Checkbox, Dropdown, Form, Spin, Tooltip } from "antd"
import hotkeys from "hotkeys-js"
import cn from "classnames"
// @Components
import { DebugEvents } from "ui/components/CodeDebugger/DebugEvents"
import { CodeEditor } from "ui/components/CodeEditor/CodeEditor"
// @Icons
import CaretRightOutlined from "@ant-design/icons/lib/icons/CaretRightOutlined"
import UnorderedListOutlined from "@ant-design/icons/lib/icons/UnorderedListOutlined"
// @Styles
import "react-reflex/styles.css"
import styles from "./CodeDebugger.module.less"
import { Event as RecentEvent } from "../../../lib/services/events"
import { SyntaxHighlighterAsync } from "lib/components/SyntaxHighlighter/SyntaxHighlighter"
import {
  CloseOutlined,
  CodeOutlined,
  LoadingOutlined,
  DownloadOutlined,
  EyeFilled,
  EyeInvisibleFilled,
} from "@ant-design/icons"

export interface CodeDebuggerProps {
  /**
   * Run handler, async.
   * That function takes form values and returns response or error
   * */
  run: (values: FormValues) => any
  /**
   * @deprecated
   * Prop to make code field hidden, visible by default
   * */
  codeFieldVisible?: boolean
  /**
   * Prop to customize label of code field, `Code` by default
   * */
  codeFieldLabel?: string
  /**
   * Additional className for wrap div
   * */
  className?: string
  /**
   * InitialValue for code field
   * */
  defaultCodeValue?: string
  /**
   * Additional code suggestions
   * */
  extraSuggestions?: string
  /**
   * Code field change handler
   * */
  handleCodeChange?: (value: string | object) => void
  /**
   * Close modal for cases with custom close button
   * */
  handleClose?: () => void
  /**
   * Callback for the `save` button
   */
  handleSaveCode?: (value: string) => void
}

export interface FormValues {
  object: string
  code: string
}

interface CalculationResult {
  code: "error" | "success"
  format: string | null
  message: string
}

const CodeDebugger = ({
  className,
  codeFieldLabel = "Table Name Expression",
  defaultCodeValue,
  extraSuggestions,
  handleCodeChange,
  handleClose,
  handleSaveCode: _handleSaveCode,
  run,
}: CodeDebuggerProps) => {
  //to save code changes on component reload and pass it here from parent in effect bellow
  const [codeValue, setCodeValue] = useState<string>(defaultCodeValue)

  const [objectInitialValue, setObjectInitialValue] = useState<string>(`{
   "event_type": "example_event",
   "advice": "Click 'Copy Recent Event' button above to paste real one from event stream." 
}`)
  //object value used for monaco code suggestions
  const [objectValue, setObjectValue] = useState<string>("")
  const [isEventsVisible, setEventsVisible] = useState<boolean>(false)
  const [calcResult, setCalcResult] = useState<CalculationResult>()
  const [runIsLoading, setRunIsLoading] = useState<boolean>(false)

  const [showInputEditor, setShowInputEditor] = useState<boolean>(true)
  const [showCodeEditor, setShowCodeEditor] = useState<boolean>(true)
  const [showOutput, setShowOutput] = useState<boolean>(false)

  const [form] = Form.useForm()

  const toggleInputEditor = useCallback(() => {
    setShowInputEditor(val => !val)
  }, [])

  const toggleCodeEditor = useCallback(() => {
    setCodeValue(form.getFieldValue("code"))
    setShowCodeEditor(val => !val)
  }, [])

  const toggleOutput = useCallback(() => {
    setShowOutput(val => !val)
  }, [])

  const handleChange = (name: "object" | "code") => (value: string | object) => {
    form.setFieldsValue({ [name]: value ? value : "" })
    if (name === "code" && handleCodeChange) {
      handleCodeChange(value)
    }
  }

  const handlePaste = () => {
    setCodeValue(form.getFieldValue("code"))
    setObjectValue(form.getFieldValue("object"))
  }

  const handleSaveCode = () => {
    _handleSaveCode(form.getFieldValue("code"))
  }

  const handleRun = async (values: FormValues) => {
    setShowOutput(true)
    setRunIsLoading(true)

    try {
      const response = await run(values)

      setCalcResult({
        code: "success",
        format: response.format,
        message: response.result,
      })
    } catch (error) {
      setCalcResult({
        code: "error",
        format: error?._response?.format,
        message: error?.message ?? "Error",
      })
    } finally {
      setRunIsLoading(false)
    }
  }

  const handleEventClick = (event: RecentEvent) => () => {
    const obj = JSON.stringify(event, null, 2)
    handleChange("object")(obj)
    setCodeValue(form.getFieldValue("code"))
    setObjectValue(obj)
    setEventsVisible(false)
  }

  const handleSwitchEventsVisible = () => setEventsVisible(isEventsVisible => !isEventsVisible)

  const handleCloseEvents = useCallback(e => {
    if (!e.target.closest(".ant-dropdown") && !e.target.closest("#events-button")) {
      setEventsVisible(false)
    }
  }, [])

  useEffect(() => {
    if (defaultCodeValue) {
      form.setFieldsValue({ code: defaultCodeValue })
      setCodeValue(defaultCodeValue)
    }
  }, [defaultCodeValue, form])

  useEffect(() => {
    document.body.addEventListener("click", handleCloseEvents)

    return () => document.body.removeEventListener("click", handleCloseEvents)
  }, [handleCloseEvents])

  return (
    <div className={cn(className, "flex flex-col items-stretch h-screen max-h-full pt-4;")}>
      <div className="w-full mb-2">
        <Controls
          inputChecked={showInputEditor}
          codeChecked={showCodeEditor}
          outputChecked={showOutput}
          toggleInput={toggleInputEditor}
          toggleCode={toggleCodeEditor}
          toggleOutput={toggleOutput}
          handleExit={handleClose}
          handleSave={handleSaveCode}
          handleRun={form.submit}
        />
      </div>
      <Form form={form} className="flex-auto relative" id="inputs" onFinish={handleRun}>
        <ReflexContainer orientation="vertical">
          {showInputEditor && (
            <ReflexElement>
              <SectionWithLabel label="Event JSON" htmlFor="object">
                <Form.Item className={`${styles.field} w-full`} name="object">
                  <CodeEditor
                    initialValue={form.getFieldValue("object") ?? objectInitialValue}
                    language={"json"}
                    handleChange={handleChange("object")}
                    handlePaste={handlePaste}
                    hotkeysOverrides={{
                      onCmdCtrlEnter: form.submit,
                      onCmdCtrlI: toggleInputEditor,
                      onCmdCtrlU: toggleCodeEditor,
                    }}
                  />
                </Form.Item>
              </SectionWithLabel>
              <Dropdown
                forceRender
                className="absolute left-28 top-0.5"
                placement="topLeft"
                overlay={<DebugEvents handleClick={handleEventClick} />}
                trigger={["click"]}
                visible={isEventsVisible}
              >
                <Button
                  size="small"
                  type="link"
                  icon={<UnorderedListOutlined />}
                  id="events-button"
                  onClick={handleSwitchEventsVisible}
                >
                  Copy Recent Event
                </Button>
              </Dropdown>
            </ReflexElement>
          )}

          {showInputEditor && <ReflexSplitter propagate className={`${styles.splitter}`} />}

          {showCodeEditor && (
            <ReflexElement>
              <SectionWithLabel label={`${codeFieldLabel}`} htmlFor="code">
                <Form.Item className={`${styles.field} pl-2 break-normal`} colon={false} name="code">
                  <CodeEditor
                    initialValue={codeValue}
                    language="javascript"
                    enableLineNumbers
                    extraSuggestions={`declare let $ = ${objectValue};
          declare let event = $;
          declare let _ = $;
          ${extraSuggestions}`}
                    reRenderEditorOnInitialValueChange={true}
                    handleChange={handleChange("code")}
                    hotkeysOverrides={{
                      onCmdCtrlEnter: form.submit,
                      onCmdCtrlI: toggleInputEditor,
                      onCmdCtrlU: toggleCodeEditor,
                    }}
                  />
                </Form.Item>
              </SectionWithLabel>
            </ReflexElement>
          )}

          {showCodeEditor && showOutput && <ReflexSplitter propagate className={`${styles.splitter}`} />}

          {showOutput && (
            <ReflexElement>
              <SectionWithLabel label="Result">
                <div className={`h-full box-border font-mono list-none px-2 pt-1 m-0 ${styles.darkenBackground}`}>
                  <div
                    className={cn("flex flex-col w-full h-full m-0", {
                      [styles.itemError]: calcResult?.code === "error",
                      [styles.itemSuccess]: calcResult?.code === "success",
                    })}
                  >
                    <strong className={cn(`absolute top-1 right-2 flex-shrink-0 text-xs`)}>
                      {runIsLoading ? (
                        <Spin indicator={<LoadingOutlined style={{ fontSize: 15 }} spin />} />
                      ) : (
                        `${calcResult?.code ?? ""}`
                      )}
                    </strong>
                    {calcResult && (
                      <span className={`flex-auto min-w-0 text-xs`}>
                        {calcResult.code === "error" ? (
                          calcResult.message
                        ) : (
                          <SyntaxHighlighterAsync
                            language="json"
                            className={`h-full w-full overflow-auto ${styles.darkenBackground} ${styles.syntaxHighlighter} ${styles.withSmallScrollbar}`}
                          >
                            {calcResult.message}
                            {/* {
                            // 'safdasfs afdasfasdgasgdfags gasgafasdf asfafasdfasf afdasfdafdda sfasfadsfas fasfafsdasfafas'
                            JSON.stringify(
                              JSON.parse(calcResult.message),
                              null,
                              2
                            )
                          } */}
                          </SyntaxHighlighterAsync>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </SectionWithLabel>
            </ReflexElement>
          )}
        </ReflexContainer>

        {/**
         * Elements below are invisible and just keep the editors values when the editors are unmounted (hidden).
         * Always keep these elements outside of the ReflexContainer, otherwise they will break the adjustable layout.
         * */}

        {!showInputEditor && (
          <Form.Item className={`hidden`} name="object">
            <CodeEditor
              initialValue={form.getFieldValue("object") ?? objectInitialValue}
              language={"json"}
              handleChange={handleChange("object")}
              // hotkeysOverrides={{
              //   onCmdCtrlEnter: form.submit,
              //   onCmdCtrlI: toggleInputEditor,
              //   onCmdCtrlU: toggleCodeEditor,
              // }}
            />
          </Form.Item>
        )}

        {!showCodeEditor && (
          <Form.Item className={`hidden`} name="code">
            <CodeEditor
              initialValue={codeValue}
              reRenderEditorOnInitialValueChange={true}
              language={"json"}
              handleChange={handleChange("code")}
              // hotkeysOverrides={{
              //   onCmdCtrlEnter: form.submit,
              //   onCmdCtrlI: toggleInputEditor,
              //   onCmdCtrlU: toggleCodeEditor,
              // }}
            />
          </Form.Item>
        )}
      </Form>
    </div>
  )
}

CodeDebugger.displayName = "CodeDebugger"

export { CodeDebugger }

/**
 * Controls
 */

const OS_CMD_BUTTON = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl"

type ControlsProps = {
  inputChecked: boolean
  codeChecked: boolean
  outputChecked: boolean
  toggleInput: () => void
  toggleCode: () => void
  toggleOutput: () => void
  handleExit: () => void
  handleSave: () => void
  handleRun: () => void
}

const ControlsComponent: React.FC<ControlsProps> = ({
  inputChecked,
  codeChecked,
  outputChecked,
  toggleInput,
  toggleCode,
  toggleOutput,
  handleExit,
  handleSave,
  handleRun,
}) => {
  useEffect(() => {
    const handleToggleInput = () => {
      toggleInput()
      return false // to prevent browsers' default behaviour
    }
    const handleToggleCode = () => {
      toggleCode()
      return false
    }
    const handleToggleOutput = () => {
      toggleOutput()
      return false
    }
    const _handleSave = (e: KeyboardEvent) => {
      e.preventDefault()
      handleSave()
      return false
    }
    const _handleRun = (e: KeyboardEvent) => {
      e.stopPropagation()
      handleRun()
      return false
    }
    const handleEscape = e => {
      if (e.key === "Escape") {
        handleExit()
      }
    }

    hotkeys.filter = () => true // to enable hotkeys everywhere, even in input fields

    hotkeys("cmd+i,ctrl+i", handleToggleInput)
    hotkeys("cmd+u,ctrl+u", handleToggleCode)
    hotkeys("cmd+o,ctrl+o", handleToggleOutput)
    hotkeys("cmd+s,ctrl+s", _handleSave)
    hotkeys("cmd+enter,ctrl+enter", _handleRun)
    document.addEventListener("keydown", handleEscape, true)

    return () => {
      hotkeys.unbind("cmd+i,ctrl+i", handleToggleInput)
      hotkeys.unbind("cmd+u,ctrl+u", handleToggleCode)
      hotkeys.unbind("cmd+o,ctrl+o", handleToggleOutput)
      hotkeys.unbind("cmd+s,ctrl+s", _handleSave)
      hotkeys.unbind("cmd+enter,ctrl+enter", _handleRun)
      document.removeEventListener("keydown", handleEscape, true)
    }
  }, [])

  return (
    <div className="flex items-stretch w-full h-full">
      <Button size="middle" className="flex-grow-0" onClick={handleExit}>
        <CloseOutlined className={styles.adaptiveIcon} />
        <span className={`${styles.adaptiveLabel} ${styles.noMargins}`}>{"Close"}</span>
      </Button>
      <div className="flex justify-center items-center flex-auto min-w-0">
        <Tooltip title={`${OS_CMD_BUTTON}+I`} mouseEnterDelay={1}>
          <Checkbox
            checked={inputChecked}
            className={cn("relative", styles.checkbox, styles.hideAntdCheckbox, styles.checkboxLabel, {
              [styles.checkboxChecked]: inputChecked,
            })}
            onClick={toggleInput}
          >
            <i className="block absolute left-0.5">{inputChecked ? <EyeFilled /> : <EyeInvisibleFilled />}</i>
            <span className={styles.adaptiveIcon}>{"{ }"}</span>
            <span className={`${styles.adaptiveLabel} ${styles.noMargins}`}>{"Input"}</span>
          </Checkbox>
        </Tooltip>
        <Tooltip title={`${OS_CMD_BUTTON}+U`} mouseEnterDelay={1}>
          <Checkbox
            checked={codeChecked}
            className={cn("relative", styles.checkbox, styles.hideAntdCheckbox, styles.checkboxLabel, {
              [styles.checkboxChecked]: codeChecked,
            })}
            onClick={toggleCode}
          >
            <i className="block absolute left-0.5">{codeChecked ? <EyeFilled /> : <EyeInvisibleFilled />}</i>
            <span className={styles.adaptiveIcon}>{"</>"}</span>
            <span className={`${styles.adaptiveLabel} ${styles.noMargins}`}>{"Expression"}</span>
          </Checkbox>
        </Tooltip>
        <Tooltip title={`${OS_CMD_BUTTON}+O`} mouseEnterDelay={1}>
          <Checkbox
            checked={outputChecked}
            className={cn("relative", styles.checkbox, styles.hideAntdCheckbox, styles.checkboxLabel, {
              [styles.checkboxChecked]: outputChecked,
            })}
            onClick={toggleOutput}
          >
            <i className="block absolute left-0.5">{outputChecked ? <EyeFilled /> : <EyeInvisibleFilled />}</i>
            <CodeOutlined className={styles.adaptiveIcon} />
            <span className={`${styles.adaptiveLabel} ${styles.noMargins}`}>{"Result"}</span>
          </Checkbox>
        </Tooltip>
      </div>
      <div className="flex-grow-0 ant-btn-group">
        <Tooltip title={`${OS_CMD_BUTTON}+↵`} mouseEnterDelay={1}>
          <Button
            size="middle"
            type="primary"
            icon={<CaretRightOutlined />}
            className={`${styles.buttonGreen}`}
            onClick={handleRun}
          >
            <span className={`${styles.adaptiveLabel}`}>{"Run"}</span>
          </Button>
        </Tooltip>
        <Tooltip title={`${OS_CMD_BUTTON}+S`} mouseEnterDelay={1}>
          <Button size="middle" type="primary" onClick={handleSave} icon={<DownloadOutlined />}>
            <span className={`${styles.adaptiveLabel}`}>{"Save"}</span>
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

const Controls = memo(ControlsComponent)

type SectionProps = {
  label: string
  labelClassName?: string
  htmlFor?: string
}

const SectionWithLabel: React.FC<SectionProps> = ({ label, labelClassName, htmlFor, children }) => {
  return (
    <div className={`relative w-full h-full overflow-hidden pt-7 rounded-md ${styles.darkenBackground}`}>
      <label className={`absolute top-1 left-2 z-10 ${styles.label} ${labelClassName ?? ""}`} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}
