// @Libs
import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Button, Col, Collapse, Form, Input, Row } from 'antd';
import MonacoEditor from 'react-monaco-editor';
import cn from 'classnames';
// @Components
import { CenteredSpin, CodeSnippet } from '@./lib/components/components';
import { CodeEditor } from '@component/CodeEditor/CodeEditor';
// @Types
import { Event as RecentEvent } from '@./lib/components/EventsStream/EventsStream';
// @Icons
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
// @Styles
import styles from './CodeDebugger.module.less';
import { find } from 'lodash-es';

// const JsonEditor = React.lazy(() => import('@component/CodeEditor/CodeEditor'));

interface Props {
  /***/
  run?: (values: FormValues) => any;
  /**
   * Prop to make code field hidden, visible by default
   * */
  codeFieldVisible?: boolean;
  /**
   * Prop to customize label of code field, `Code` by default
   * */
  codeFieldLabel?: string;
  /**
   * Pass this as true if you want to use custom button and control its state by yourself
   * */
  hideRunButton?: boolean;

  /**
   * Additional className for wrap div
   * */
  className?: string;
}

interface FormValues {
  event: RecentEvent;
  expression: string;
}

type ResultType = 'output' | 'debug';

const CodeDebugger = ({
  className,
  run,
  codeFieldVisible = true,
  codeFieldLabel = 'Code',
  hideRunButton
}: Props) => {
  const resultHeader: Record<ResultType, string> = {
    output: 'Response',
    debug: 'Debug log'
  };

  const monacoJsonRef = useRef<MonacoEditor>();
  const monacoGoRef = useRef<MonacoEditor>();

  const [eventsCount, setEventsCount] = useState<number>(-1);

  const [resultType, setResultType] = useState<ResultType>();
  const [result, setResult] = useState();

  const [runButtonIsLoading, setRunButtonIsLoading] = useState<boolean>(false);

  const [form] = Form.useForm();

  const handleChange = (name: 'object' | 'expression') => (value: string) => {
    form.setFieldsValue({ [name]: value ? value : '' });
  };

  const handleFinish = async(values: FormValues) => {
    setRunButtonIsLoading(true);

    try {
      const codeDebugResult = await run(values);

      setResultType('output');
      setResult(codeDebugResult);

      return codeDebugResult;
    } catch(error) {
      setResultType('debug');
      setResult(error);

      return error;
    } finally {
      setRunButtonIsLoading(false);
    }
  };

  // const handleEventClick = (event: RecentEvent) => (e: React.SyntheticEvent) => {
  //   e.stopPropagation();
  //
  //   const monacoModel = monacoJsonRef.current.editor.getModel();
  //
  //   monacoModel.setValue(JSON.stringify(event));
  //
  //   form.setFieldsValue({ object: event ? event : '' });
  // };
  //
  // const handleEventsLoaded = (count: number) => setEventsCount(count);

  return (
    <div className={cn(className)}>
      <Form form={form} onFinish={handleFinish}>
        <Row>
          <Col span={codeFieldVisible ? 12 : 24}>
            <Form.Item
              className={styles.field}
              colon
              label="Object"
              labelAlign="left"
              name="object"
            >
              <CodeEditor handleChange={handleChange('object')} monacoRef={monacoJsonRef} height={200} />
            </Form.Item>
          </Col>

          {
            codeFieldVisible && (
              <Col span={12}>
                <Form.Item
                  className={styles.field}
                  colon
                  label={codeFieldLabel}
                  labelAlign="left"
                  name="code"
                >
                  <CodeEditor handleChange={handleChange('expression')} monacoRef={monacoGoRef} height={200} language="go" />
                </Form.Item>
              </Col>
            )
          }
        </Row>

        {/*{*/}
        {/*  eventsCount !== 0 && <div className="mb-6">*/}
        {/*    <Collapse>*/}
        {/*      <Collapse.Panel header="Recent Events" key="1" className={styles.panel} forceRender>*/}
        {/*        <div className={cn(styles.events, 'max-h-48')}>*/}
        {/*          <EventsStream dataLoadCb={handleEventsLoaded} withTop={false} handleEventClick={handleEventClick} />*/}
        {/*        </div>*/}
        {/*      </Collapse.Panel>*/}
        {/*    </Collapse>*/}
        {/*  </div>*/}
        {/*}*/}

        {
          result && <div className="mb-6">
            <CodeSnippet
              toolbarPosition="top"
              language="json"
              size="large"
              extra={<span className={styles.resultHeader}>{resultHeader[resultType]}</span>}
            >
              {JSON.stringify(result)}
            </CodeSnippet>
          </div>
        }

        {
          !hideRunButton && <div className={styles.buttonContainer}>
            <Button loading={runButtonIsLoading} type="primary" htmlType="submit" icon={<CaretRightOutlined />}>Run</Button>
          </div>
        }
      </Form>
    </div>
  )
};

CodeDebugger.displayName = 'CodeDebugger';

export { CodeDebugger };
