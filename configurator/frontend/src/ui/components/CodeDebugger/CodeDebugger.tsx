// @Libs
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Col, Dropdown, Form, Row, Tabs } from 'antd';
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
   * @deprecated
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
  run
}: CodeDebuggerProps) => {
  const rowWrapRef = useRef<HTMLDivElement>();

  const [objectInitialValue, setObjectInitialValue] = useState<string>();

  const [isEventsVisible, switchEventsVisible] = useState<boolean>(false);

  const [calcResult, setCalcResult] = useState<CalculationResult>();

  const [runIsLoading, setRunIsLoading] = useState<boolean>();

  const [form] = Form.useForm();

  const handleChange =
    (name: 'object' | 'code') => (value: string | object) => {
      form.setFieldsValue({ [name]: value ? value : '' });
      if (name === 'code' && handleCodeChange) {
        handleCodeChange(value);
      }
    };

  const handleFinish = async (values: FormValues) => {
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

    switchEventsVisible(false);
  };

  const handleSwitchEventsVisible = () => switchEventsVisible(!isEventsVisible);

  const handleCloseEvents = useCallback((e) => {
    if (
      !e.target.closest('.ant-dropdown') &&
      !e.target.closest('#events-button')
    ) {
      switchEventsVisible(false);
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
      <Form form={form} className="flex-auto" onFinish={handleFinish}>
        <Row ref={rowWrapRef} className="h-full">
          <Col span={12} className={'flex flex-col h-full pr-1'}>
            <label
              htmlFor="object"
              className="flex justify-between items-center h-12"
            >
              <span className="block flex-grow-0">{'Event JSON'}</span>
              <Dropdown
                forceRender
                className="flex-grow-0"
                placement="bottomRight"
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
            </label>
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
          </Col>

          <Col span={12} className="flex flex-col pl-1">
            <label
              htmlFor="object"
              className="flex justify-between items-center h-12"
            >
              <span className="block flex-grow-0">
                {codeFieldLabel ?? 'Code'}
              </span>
              <Button
                htmlType="submit"
                size="small"
                icon={<CaretRightOutlined />}
                loading={runIsLoading}
                type="primary"
              >
                Run
              </Button>
            </label>
            <Form.Item className={styles.field} colon={false} name="code">
              <CodeEditor
                initialValue={defaultCodeValue}
                handleChange={handleChange('code')}
                language="javascript"
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <div
        className={`flex-auto max-h-40 box-border rounded-md font-mono list-none p-4 m-0 ${styles.darkenBackground}`}
      >
        {calcResult && (
          <p
            className={cn('flex items-stretch w-full h-full m-0', {
              [styles.itemError]: calcResult.code === 'error',
              [styles.itemSuccess]: calcResult.code === 'success'
            })}
          >
            <strong
              className={`whitespace-pre-wrap pr-3 flex-shrink-0 text-xs`}
            >
              {`${calcResult.code}${
                calcResult.format ? `(${calcResult.format})` : ''
              }:`}
            </strong>
            <span className={`flex-auto min-w-0 whitespace-pre-wrap text-xs`}>
              {calcResult.code === 'error' ? (
                calcResult.message
              ) : (
                <SyntaxHighlighterAsync
                  language="json"
                  className={`h-full w-full overflow-auto ${styles.darkenBackground} ${styles.syntaxHighlighter} ${styles.withSmallScrollbar}`}
                >
                  {
                    // 'safdasfs afdasfasdgasgdfags gasgafasdf asfafasdfasf afdasfdafdda sfasfadsfas fasfafsdasfafas'
                    JSON.stringify(JSON.parse(calcResult.message), null, 2)
                  }
                </SyntaxHighlighterAsync>
              )}
            </span>
          </p>
        )}
      </div>
    </div>
  );
};

CodeDebugger.displayName = 'CodeDebugger';

export { CodeDebugger };
