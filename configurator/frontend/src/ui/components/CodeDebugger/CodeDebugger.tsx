// @Libs
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dropdown, Form, Spin } from 'antd';
import cn from 'classnames';
// @Components
import { DebugEvents } from 'ui/components/CodeDebugger/DebugEvents';
import { CodeEditor } from 'ui/components/CodeEditor/CodeEditor';
// @Types
// @Icons
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
import UnorderedListOutlined from '@ant-design/icons/lib/icons/UnorderedListOutlined';
// @Styles
import styles from './CodeDebugger.module.less';
import { Event as RecentEvent } from '../../../lib/services/events';
import { SyntaxHighlighterAsync } from 'lib/components/SyntaxHighlighter/SyntaxHighlighter';
import { CodeOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons';

export interface CodeDebuggerProps {
  /**
   * Run handler, async.
   * That function takes form values and returns response or error
   * */
  run: (values: FormValues) => any;
  /**
   * @deprecated
   * Prop to make code field hidden, visible by default
   * */
  codeFieldVisible?: boolean;
  /**
   * Prop to customize label of code field, `Code` by default
   * */
  codeFieldLabel?: string;
  /**
   * Additional className for wrap div
   * */
  className?: string;
  /**
   * InitialValue for code field
   * */
  defaultCodeValue?: string;
  /**
   * Code field change handler
   * */
  handleCodeChange?: (value: string | object) => void;
  /**
   * Close modal for cases with custom close button
   * */
  handleClose?: () => void;
}

export interface FormValues {
  object: string;
  code: string;
}

interface CalculationResult {
  code: 'error' | 'success';
  format: string | null;
  message: string;
}

const CodeDebugger = ({
  className,
  codeFieldLabel = 'Table Name expression',
  defaultCodeValue,
  handleCodeChange,
  handleClose,
  run
}: CodeDebuggerProps) => {
  const rowWrapRef = useRef<HTMLDivElement>();

  const [objectInitialValue, setObjectInitialValue] = useState<string>();
  const [isEventsVisible, setEventsVisible] = useState<boolean>(false);
  const [calcResult, setCalcResult] = useState<CalculationResult>();
  const [runIsLoading, setRunIsLoading] = useState<boolean>(false);

  const [showInputEditor, setShowInputEditor] = useState<boolean>(true);
  const [showCodeEditor, setShowCodeEditor] = useState<boolean>(true);
  const [showResultCol, setShowResultCol] = useState<boolean>(false);

  const [form] = Form.useForm();

  const toggleInputEditor = useCallback(() => {
    setShowInputEditor((val) => !val);
  }, []);

  const toggleCodeEditor = useCallback(() => {
    setShowCodeEditor((val) => !val);
  }, []);

  const toggleResultCol = useCallback(() => {
    setShowResultCol((val) => !val);
  }, []);

  const handleChange =
    (name: 'object' | 'code') => (value: string | object) => {
      form.setFieldsValue({ [name]: value ? value : '' });
      if (name === 'code' && handleCodeChange) {
        handleCodeChange(value);
      }
    };

  const handleFinish = async (values: FormValues) => {
    setShowResultCol(true);
    setRunIsLoading(true);

    try {
      const response = await run(values);

      setCalcResult({
        code: 'success',
        format: response.format,
        message: response.result
      });
    } catch (error) {
      setCalcResult({
        code: 'error',
        format: error?._response?.format,
        message: error?.message ?? 'Error'
      });
    } finally {
      setRunIsLoading(false);
    }
  };

  const handleEventClick = (event: RecentEvent) => () => {
    setObjectInitialValue(JSON.stringify(event, null, 2));

    handleChange('object')(JSON.stringify(event));

    setEventsVisible(false);
  };

  const handleSwitchEventsVisible = () =>
    setEventsVisible((isEventsVisible) => !isEventsVisible);

  const handleCloseEvents = useCallback((e) => {
    if (
      !e.target.closest('.ant-dropdown') &&
      !e.target.closest('#events-button')
    ) {
      setEventsVisible(false);
    }
  }, []);

  useEffect(() => {
    if (defaultCodeValue) {
      form.setFieldsValue({ code: defaultCodeValue });
    }
  }, [defaultCodeValue]);

  useEffect(() => {
    document.body.addEventListener('click', handleCloseEvents);

    return () => document.body.removeEventListener('click', handleCloseEvents);
  }, [handleCloseEvents]);

  return (
    <div
      className={cn(
        className,
        'flex flex-col items-stretch h-screen max-h-full pt-4;'
      )}
    >
      <div className="w-full mb-4">
        <Controls
          formId="inputs"
          inputChecked={showInputEditor}
          codeChecked={showCodeEditor}
          outputChecked={showResultCol}
          toggleInput={toggleInputEditor}
          toggleCode={toggleCodeEditor}
          toggleOutput={toggleResultCol}
          handleExit={handleClose}
        />
      </div>
      <Form
        form={form}
        className="flex-auto"
        id="inputs"
        onFinish={handleFinish}
      >
        <div ref={rowWrapRef} className={`flex items-stretch h-full`}>
          <div
            className={`flex flex-col relative h-full pr-2 ${styles.column} ${
              !showInputEditor && 'hidden'
            }`}
          >
            <SectionWithLabel label="Event JSON" htmlFor="object">
              <Form.Item
                className={`${styles.field} w-full`}
                colon={false}
                name="object"
              >
                <CodeEditor
                  initialValue={objectInitialValue}
                  language={'json'}
                  handleChange={handleChange('object')}
                />
              </Form.Item>
            </SectionWithLabel>
            <Dropdown
              forceRender
              className="absolute right-4 bottom-3"
              placement="topRight"
              overlay={<DebugEvents handleClick={handleEventClick} />}
              trigger={['click']}
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
          </div>

          <div
            className={`px-1 ${styles.columnWide} ${
              !showCodeEditor && 'hidden'
            }`}
          >
            <SectionWithLabel label={codeFieldLabel} htmlFor="code">
              <Form.Item
                className={`${styles.field} pl-2`}
                colon={false}
                name="code"
              >
                <CodeEditor
                  initialValue={defaultCodeValue}
                  language="javascript"
                  enableLineNumbers
                  handleChange={handleChange('code')}
                />
              </Form.Item>
            </SectionWithLabel>
          </div>

          <div
            className={`pl-1 ${styles.column} ${!showResultCol && 'hidden'}`}
          >
            <SectionWithLabel label="Result">
              <div
                className={`h-full box-border font-mono list-none px-2 pt-1 m-0 ${styles.darkenBackground}`}
              >
                <p
                  className={cn('flex flex-col w-full h-full m-0', {
                    [styles.itemError]: calcResult?.code === 'error',
                    [styles.itemSuccess]: calcResult?.code === 'success'
                  })}
                >
                  <strong
                    className={cn(
                      `absolute top-1 right-2 flex-shrink-0 text-xs`
                    )}
                  >
                    {runIsLoading ? (
                      <Spin
                        indicator={
                          <LoadingOutlined style={{ fontSize: 15 }} spin />
                        }
                      />
                    ) : (
                      `${calcResult?.code ?? ''}`
                    )}
                  </strong>
                  {calcResult && (
                    <span className={`flex-auto min-w-0 text-xs`}>
                      {calcResult.code === 'error' ? (
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
                </p>
              </div>
            </SectionWithLabel>
          </div>
        </div>
      </Form>
    </div>
  );
};

CodeDebugger.displayName = 'CodeDebugger';

export { CodeDebugger };

type ControlsProps = {
  formId: string;
  inputChecked: boolean;
  codeChecked: boolean;
  outputChecked: boolean;
  toggleInput: () => void;
  toggleCode: () => void;
  toggleOutput: () => void;
  handleExit: () => void;
};

const ControlsComponent: React.FC<ControlsProps> = ({
  formId,
  inputChecked,
  codeChecked,
  outputChecked,
  toggleInput,
  toggleCode,
  toggleOutput,
  handleExit
}) => {
  return (
    <div className="flex w-full h-full">
      <Button size="large" className="flex-grow-0" onClick={handleExit}>
        {'Esc'}
      </Button>
      <div className="flex justify-center flex-auto min-w-0">
        <Button
          size="large"
          className={`mr-1 ${styles.selectableButton} ${
            inputChecked && styles.buttonSelected
          }`}
          onClick={toggleInput}
        >
          {'{  }'}
        </Button>
        <Button
          size="large"
          className={`mr-1 ${styles.selectableButton} ${
            codeChecked && styles.buttonSelected
          }`}
          onClick={toggleCode}
        >
          {'</>'}
        </Button>
        <Button
          size="large"
          className={`${styles.selectableButton} ${
            outputChecked && styles.buttonSelected
          }`}
          onClick={toggleOutput}
        >
          <CodeOutlined />
        </Button>
      </div>
      <div className="flex-grow-0">
        <Button
          size="large"
          type="primary"
          icon={<CaretRightOutlined />}
          className={`mr-1 ${styles.buttonGreen}`}
          htmlType="submit"
          form={formId}
        />
        <Button size="large" type="primary" icon={<SaveOutlined />} />
      </div>
    </div>
  );
};

const Controls = memo(ControlsComponent);

type SectionProps = {
  label: string;
  htmlFor?: string;
};

const SectionWithLabel: React.FC<SectionProps> = ({
  label,
  htmlFor,
  children
}) => {
  return (
    <div
      className={`relative w-full h-full overflow-hidden pt-6 rounded-md ${styles.darkenBackground}`}
    >
      <label
        className={`absolute top-1 left-2 z-10 ${styles.label}`}
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
    </div>
  );
};
