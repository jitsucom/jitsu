// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Form, message, Tabs } from 'antd';
// @Types
import { FormProps as Props } from './SourceForm.types';
// @Components
import { SourceFormConfig } from './SourceFormConfig';
import { SourceFormCollections } from './SourceFormCollections';
import { handleError } from '../../../../../../lib/components/components';
// @Icons
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
// @Services
import ApplicationServices from '@service/ApplicationServices';

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  alreadyExistSources,
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

  return (
    <Form autoComplete="off" name={formName} onFinish={handleFinish} className="source-form">
      <div className="flex-grow">
        <Tabs defaultActiveKey="config" type="card" size="middle" className="form-tabs">
          <Tabs.TabPane tab="Config" key="config">
            <SourceFormConfig
              initialValues={initialValues}
              alreadyExistSources={alreadyExistSources}
              connectorSource={connectorSource}
            />
          </Tabs.TabPane>
          {
            connectorSource.collectionParameters.length > 0 && <Tabs.TabPane tab="Collections" key="collections">
              <SourceFormCollections initialValues={initialValues} connectorSource={connectorSource} />
            </Tabs.TabPane>
          }
        </Tabs>
      </div>

      <div className="flex-shrink border-t pt-2">
        <Form.Item>
          <Button
            key="pwd-login-button"
            type="primary"
            htmlType="submit"
            className="login-form-button"
            loading={isRequestPending}
          >
            <span style={{ textTransform: 'capitalize' }}>{formMode}</span>&nbsp;source
          </Button>
        </Form.Item>

        <Button className="fields-group" type="dashed" onClick={handleClick} loading={connectionTestPending} icon={<ApiOutlined />}>Test connection</Button>
      </div>
    </Form>
  );
};

SourceForm.displayName = 'SourceForm';

export { SourceForm };
