// @Libs
import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Dropdown, Form, Row, Tabs } from 'antd';
import MonacoEditor from 'react-monaco-editor';
import moment from 'moment';
import cn from 'classnames';
import debounce from 'lodash/debounce';
// @Components
import { DebugEvents } from '@component/CodeDebugger/DebugEvents';
import { CodeEditor } from '@component/CodeEditor/CodeEditor';
// @Types
import { Event as RecentEvent } from '@./lib/components/EventsStream/EventsStream';
// @Icons
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
// @Styles
import styles from './CodeDebugger.module.less';
import { UnorderedListOutlined } from '@ant-design/icons';

interface Props {
  /**
   * Run handler, async thata
   * function takes form values and returns response or error
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
}

export interface FormValues {
  object: string;
  code: string;
}

interface Debug {
  code: 'debug' | 'output';
  message: string;
  key: number;
}

const CodeDebugger = ({
  className,
  codeFieldVisible = true,
  codeFieldLabel = 'Code',
  defaultCodeValue,
  run
}: Props) => {
  const objectMonacoRef = useRef<MonacoEditor>();
  const codeMonacoRef = useRef<MonacoEditor>();

  const [activeTab, setActiveTab] = useState<'debug' | 'output'>('debug');
  const [outputValue, setOutputValue] = useState();
  const [debug, setDebug] = useState<Debug[]>([]);

  const [runIsLoading, setRunIsLoading] = useState<boolean>();

  const [form] = Form.useForm();

  const formatObjectField = debounce(() => objectMonacoRef.current.editor.getAction('editor.action.formatDocument').run(), 1000);

  const handleChange = (name: 'object' | 'code') => (value: string | object) => {
    form.setFieldsValue({ [name]: value ? value : '' });

    if (name === 'object') {
      formatObjectField();
    }
  };

  const handleFinish = async(values: FormValues) => {
    setRunIsLoading(true);

    try {
      const response = await run(values);

      setActiveTab('output');

      setOutputValue(response.result);

      setDebug([
        ...debug,
        {
          code: 'output',
          message: response.result,
          key: (new Date()).getTime()
        }
      ]);
    } catch(error) {
      setActiveTab('debug');

      setDebug([
        ...debug,
        {
          code: 'debug',
          message: error?.message ?? 'Error',
          key: (new Date()).getTime()
        }
      ]);
    } finally {
      setRunIsLoading(false);

      const tabScrollingEl = document.querySelector('#addDebugRow');

      setTimeout(() => tabScrollingEl.scrollIntoView(), 200);
    }
  };

  const handleEventClick = (event: RecentEvent) => () => {
    const monacoModel = objectMonacoRef.current.editor.getModel();
    monacoModel.setValue(JSON.stringify(event));

    handleChange('object')(JSON.stringify(event));
  };

  useEffect(() => {
    if (defaultCodeValue) {
      form.setFieldsValue({ code: defaultCodeValue });
    }
  }, [defaultCodeValue]);

  return (
    <div className={cn(className)}>
      <Form form={form} onFinish={handleFinish}>
        <div className={styles.buttonContainer}>
          <Dropdown
            trigger={['click']}
            overlay={<DebugEvents handleClick={handleEventClick} />}
            forceRender
          >
            <Button icon={<UnorderedListOutlined />} className="ml-8">Events</Button>
          </Dropdown>
          <Button
            className="ml-8"
            htmlType="submit"
            icon={<CaretRightOutlined />}
            loading={runIsLoading}
            type="primary"
          />
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

        {
          debug.length > 0 && (
            <Tabs
              activeKey={activeTab}
              className={styles.tabs}
              onChange={(activeTab: 'output' | 'debug') => setActiveTab(activeTab)}
              tabPosition="left"
            >
              <Tabs.TabPane key="output" tab="Output" forceRender>
                <p className={styles.output}>Result: <em>{outputValue}</em></p>
              </Tabs.TabPane>
              <Tabs.TabPane key="debug" tab="Debug" forceRender className={styles.debugTab}>
                <ul className={styles.debug}>
                  {
                    debug.map((msg: Debug) => (
                      <li className={cn(styles.item, msg.code === 'debug' && styles.error)} key={msg.key}>
                        <span className={styles.status}>{msg.code} <em className={styles.time}>{moment(msg.key).format('HH:MM:ss.SSS')}</em></span>
                        <span className={styles.message}>{msg.message}</span>
                      </li>
                    ))
                  }
                  <li id="addDebugRow" />
                </ul>
              </Tabs.TabPane>
            </Tabs>
          )
        }
      </Form>
    </div>
  )
};

CodeDebugger.displayName = 'CodeDebugger';

export { CodeDebugger };
