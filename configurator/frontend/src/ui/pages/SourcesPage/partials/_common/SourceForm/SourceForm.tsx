// @Libs
import React, { useMemo } from 'react';
import { Button, Form, Tabs } from 'antd';
// @Types
import { FormProps as Props } from './SourceForm.types';
// @Components
import { SourceFormConfig } from './SourceFormConfig';
import { SourceFormCollections } from './SourceFormCollections';

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  alreadyExistSources,
  initialValues = {},
  formMode
}: Props) => {
  const formName = useMemo<string>(() => `add-source-${connectorSource.id}`, [connectorSource.id]);

  return (
    <Form autoComplete="off" name={formName} onFinish={handleFinish}>
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
    </Form>
  );
};

SourceForm.displayName = 'SourceForm';

export { SourceForm };
