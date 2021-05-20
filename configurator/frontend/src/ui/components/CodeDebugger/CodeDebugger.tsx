// @Libs
import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Button, Col, Collapse, Form, Input, Row } from 'antd';
import MonacoEditor from 'react-monaco-editor';
import cn from 'classnames';
// @Components
import { CenteredSpin, CodeSnippet } from '@./lib/components/components';
import EventsStream from '@./lib/components/EventsStream/EventsStream';
// @Types
import { Event as RecentEvent } from '@./lib/components/EventsStream/EventsStream';
// @Icons
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
// @Styles
import styles from './CodeDebugger.module.less';
import { find } from 'lodash-es';

const JsonEditor = React.lazy(() => import('@component/JsonEditor/JsonEditor'));

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

  const monacoRef = useRef<MonacoEditor>();

  const [eventsCount, setEventsCount] = useState<number>(-1);

  const [resultType, setResultType] = useState<ResultType>();
  const [result, setResult] = useState();

  const [runButtonIsLoading, setRunButtonIsLoading] = useState<boolean>(false);

  const [form] = Form.useForm();

  const handleChange = (value: string) => {
    form.setFieldsValue({ object: value ? value : '' });
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

  const handleEventClick = (event: RecentEvent) => (e: React.SyntheticEvent) => {
    e.stopPropagation();

    const monacoModel = monacoRef.current.editor.getModel();

    monacoModel.setValue(JSON.stringify(event));

    form.setFieldsValue({ object: event ? event : '' });
  };

  const handleEventsLoaded = (count: number) => setEventsCount(count);
  console.log('RENDER');

  return (
    <div className={cn(className)}>
      <Form form={form} onFinish={handleFinish}>
        <Form.Item
          className={styles.field}
          colon
          label="Object (fill in this field or just click on the event below the field)"
          labelAlign="left"
          name="object"
        >
          <React.Suspense fallback={<CenteredSpin/>}>
            <JsonEditor handleChange={handleChange} monacoRef={monacoRef} height={200} />
          </React.Suspense>
        </Form.Item>

        {
          eventsCount !== 0 && <div className="mb-6">
            <Collapse>
              <Collapse.Panel header="Recent Events" key="1" className={styles.panel} forceRender>
                <div className={cn(styles.events, 'max-h-48')}>
                  <EventsStream dataLoadCb={handleEventsLoaded} withTop={false} handleEventClick={handleEventClick} />
                </div>
              </Collapse.Panel>
            </Collapse>
          </div>
        }

        {
          codeFieldVisible && (
            <Form.Item
              className={styles.field}
              colon
              label={codeFieldLabel}
              labelAlign="left"
              name="code"
            >
              <Input className={styles.input} />
            </Form.Item>
          )
        }

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
