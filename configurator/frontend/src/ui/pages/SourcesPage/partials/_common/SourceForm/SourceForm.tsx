// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Form, message, Tabs } from 'antd';
// @Types
import { FormProps as Props } from './SourceForm.types';
// @Components
import { SourceFormConfig } from './SourceFormConfig';
import { SourceFormCollections } from './SourceFormCollections';
import { handleError } from '@./lib/components/components';
// @Icons
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
// @Services
import ApplicationServices from '@service/ApplicationServices';

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  sources,
  initialValues = {},
  formMode
}: Props) => {
  const [connectionTestPending, setConnectionTestPending] = useState<boolean>();

  const services = useMemo(() => ApplicationServices.get(), []);

  const formName = useMemo<string>(() => `add-source-${connectorSource.id}`, [connectorSource.id]);

  const handleClick = useCallback(async() => {
    setConnectionTestPending(true);

    try {
      await services.backendApiClient.post('sources/test', {});

      message.success('Successfully connected!');
    } catch (error) {
      handleError(error, 'Unable to test connection with filled data');
    } finally {
      setConnectionTestPending(false);
    }
  }, [services]);

  const [form] = Form.useForm();

  const handleButtonClick = useCallback(async() => {
    try {
      const values = await form.validateFields();

      handleFinish(values);
    } catch (errors) {
      console.log('errors: ', errors);
    }
  }, [form, handleFinish]);

  return (
    <Form form={form} autoComplete="off" name={formName} onFinish={handleFinish} className="source-form">
      <div className="flex-grow">
        <Tabs defaultActiveKey="config" type="card" size="middle" className="form-tabs">
          <Tabs.TabPane tab={<span>Config</span>} key="config">
            <SourceFormConfig
              initialValues={initialValues}
              sources={sources}
              connectorSource={connectorSource}
              sourceIdMustBeUnique={formMode === 'create'}
            />
          </Tabs.TabPane>
          {
            connectorSource.collectionParameters.length > 0 &&
            <Tabs.TabPane tab="Collections" key="collections" forceRender>
              <SourceFormCollections initialValues={initialValues} connectorSource={connectorSource} form={form}/>
            </Tabs.TabPane>
          }
        </Tabs>
      </div>

      <div className="flex-shrink border-t pt-2">
        <Button
          key="pwd-login-button"
          type="primary"
          htmlType="button"
          size="large"
          className="mr-3"
          loading={isRequestPending}
          onClick={handleButtonClick}
        >
          <span style={{ textTransform: 'capitalize' }}>{formMode}</span>&nbsp;source
        </Button>

        <Button
          size="large"
          className="mr-3"
          type="dashed"
          onClick={handleClick}
          loading={connectionTestPending}
          icon={<ApiOutlined/>}
        >Test connection</Button>
      </div>
    </Form>
  );
};

SourceForm.displayName = 'SourceForm';

export { SourceForm };
