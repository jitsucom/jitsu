// @Libs
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Col, Dropdown, Form, Row, Tabs } from 'antd';
import MonacoEditor from 'react-monaco-editor';
import cn from 'classnames';
import debounce from 'lodash/debounce';
// @Components
import { DebugEvents } from '@component/CodeDebugger/DebugEvents';
import { CodeEditor } from '@component/CodeEditor/CodeEditor';
// @Types
import { Event as RecentEvent } from '@./lib/components/EventsStream/EventsStream';
// @Icons
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
import UnorderedListOutlined from '@ant-design/icons/lib/icons/UnorderedListOutlined';
import CheckOutlined from '@ant-design/icons/lib/icons/CheckOutlined';
import CloseOutlined from '@ant-design/icons/lib/icons/CloseOutlined';
// @Styles
import styles from './CodeDebugger.module.less';

interface Props {
  /**
   * Run handler, async.
   * That function takes form values and returns response or error
   * */
  run: (values: FormValues) => any;
  /**
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
  message: string;
}

const CodeDebugger = ({
  className,
  codeFieldVisible = true,
  codeFieldLabel = 'Code',
  defaultCodeValue,
  handleCodeChange,
  handleClose,
  run
}: Props) => {
  const objectMonacoRef = useRef<MonacoEditor>();
  const codeMonacoRef = useRef<MonacoEditor>();

  const [isEventsVisible, switchEventsVisible] = useState<boolean>(false);

  const [calcResult, setCalcResult] = useState<CalculationResult>();

  const [runIsLoading, setRunIsLoading] = useState<boolean>();

  const [form] = Form.useForm();

  const formatObjectField = () => objectMonacoRef.current.editor.getAction('editor.action.formatDocument').run();

  const handleChange = (name: 'object' | 'code', instant?: boolean) => (value: string | object) => {
    form.setFieldsValue({ [name]: value ? value : '' });

    if (name === 'object') {
      if (!instant) {
        debounce(formatObjectField, 2000)();
      } else {
        formatObjectField();
      }
    }

    if (name === 'code' && handleCodeChange) {
      handleCodeChange(value);
    }
  };

  const handleFinish = async(values: FormValues) => {
    setRunIsLoading(true);

    try {
      const response = await run(values);

      setCalcResult({
        code: 'success',
        message: response.result
      });
    } catch(error) {
      setCalcResult({
        code: 'error',
        message: error?.message ?? 'Error'
      });
    } finally {
      setRunIsLoading(false);
    }
  };

  const handleEventClick = (event: RecentEvent) => () => {
    const monacoModel = objectMonacoRef.current.editor.getModel();
    monacoModel.setValue(JSON.stringify(event));

    handleChange('object', true)(JSON.stringify(event));

    switchEventsVisible(false);
  };

  const handleSwitchEventsVisible = () => switchEventsVisible(!isEventsVisible);

  const handleCloseEvents = useCallback((e) => {
    if (!e.target.closest('.ant-dropdown') && !e.target.closest('#events-button')) {
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
    <div className={cn(className)}>
      <Form form={form} onFinish={handleFinish}>
        <div className={styles.buttonContainer}>
          <Button
            className="ml-2"
            htmlType="submit"
            icon={<CaretRightOutlined />}
            loading={runIsLoading}
            type="primary"
          />
          <Dropdown
            forceRender
            overlay={<DebugEvents handleClick={handleEventClick} />}
            trigger={['click']}
            visible={isEventsVisible}
          >
            <Button
              className="ml-2"
              icon={<UnorderedListOutlined />}
              id="events-button"
              onClick={handleSwitchEventsVisible}
            />
          </Dropdown>
          {
            handleClose && <Button icon={<CloseOutlined />} className="ml-4" onClick={handleClose} />
          }
        </div>

        <Row>
          <Col span={codeFieldVisible ? 12 : 24} className={cn(codeFieldVisible && 'pr-2')}>
            <Form.Item
              className={styles.field}
              colon
              label="Object"
              labelAlign="left"
              name="object"
            >
              <CodeEditor
                handleChange={handleChange('object')}
                height={200}
                monacoRef={objectMonacoRef}
              />
            </Form.Item>
          </Col>

          {
            codeFieldVisible && (
              <Col span={12} className="pl-2">
                <Form.Item
                  className={styles.field}
                  colon
                  label={codeFieldLabel}
                  labelAlign="left"
                  name="code"
                >
                  <CodeEditor
                    initialValue={defaultCodeValue}
                    handleChange={handleChange('code')}
                    height={200}
                    language="go"
                    monacoRef={codeMonacoRef}
                  />
                </Form.Item>
              </Col>
            )
          }
        </Row>

        <Tabs
          activeKey={'output'}
          className={styles.tabs}
          tabPosition="left"
        >
          <Tabs.TabPane key="output" tab={<CheckOutlined />} forceRender className={styles.outputTab}>
            <div className={styles.output}>
              {
                calcResult && <p
                  className={cn(styles.item, {
                    [styles.itemError]: calcResult.code === 'error',
                    [styles.itemSuccess]: calcResult.code === 'success'
                  })}>
                  <strong className={styles.status}>{calcResult.code}</strong>
                  <span className={styles.message}>{calcResult.message}</span>
                </p>
              }
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Form>
    </div>
  )
};

CodeDebugger.displayName = 'CodeDebugger';

export { CodeDebugger };
