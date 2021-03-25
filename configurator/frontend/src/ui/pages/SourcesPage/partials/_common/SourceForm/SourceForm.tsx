// @Libs
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Popover, Button, Form, message, Tabs } from 'antd';
import { capitalize } from 'lodash';
// @Types
import { FormProps as Props } from './SourceForm.types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
// @Components
import { SourceFormConfig } from './SourceFormConfig';
import { SourceFormCollections } from './SourceFormCollections';
import { handleError } from '@./lib/components/components';
// @Icons
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Hooks
import { useForceUpdate } from '@hooks/useForceUpdate';

interface Tab {
  name: string;
  form: FormInstance;
  getComponent: (form: FormInstance) => JSX.Element;
  errorsCount: number;
}

interface TabsMap {
 [key: string]: Tab;
}

const sourceFormCleanFunctions = {
  getErrorsCount: (tabs: TabsMap) => Object.keys(tabs).reduce((result: number, key: string) => {
    result += tabs[key].errorsCount;
    return result;
  }, 0),
  getErrors: (tabs: TabsMap) => (<ul>
    {Object
      .keys(tabs)
      .reduce((result: React.ReactNode[], key: string) => {
        if (tabs[key].errorsCount > 0) {
          result.push(<li key={key}>{tabs[key].errorsCount} error(s) at `{tabs[key].name}` tab;</li>)
        }

        return result;
      }, [])}
  </ul>),
  getTabName: (currentTab: Tab) => currentTab.errorsCount === 0 ? currentTab.name : <span className="tab-name tab-name_error">{currentTab.name} <sup>{currentTab.errorsCount}</sup></span>
};

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  sources,
  initialValues = {},
  formMode
}: Props) => {
  const forceUpdate = useForceUpdate();

  const [connectionTestPending, setConnectionTestPending] = useState<boolean>();

  const mutableRefObject = useRef<{ tabs: TabsMap; submitOnce: boolean; }>({
    tabs: {
      config: {
        name: 'Config',
        form: Form.useForm()[0],
        getComponent: () => <SourceFormConfig initialValues={initialValues} connectorSource={connectorSource} sources={sources} sourceIdMustBeUnique={formMode === 'create'} />,
        errorsCount: 0
      },
      collections: {
        name: 'Collections',
        form: Form.useForm()[0],
        getComponent: (form: FormInstance) => <SourceFormCollections initialValues={initialValues} connectorSource={connectorSource} form={form} />,
        errorsCount: 0
      }
    },
    submitOnce: false
  });

  const services = useMemo(() => ApplicationServices.get(), []);

  const handleTestConnectionClick = useCallback(async() => {
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

  const handleTabSubmit = useCallback(async(key: string) => {
    const currentTab = mutableRefObject.current.tabs[key];

    try {
      return await currentTab.form.validateFields();
    } catch (errors) {
      const tabToUpdate = { ...currentTab, errorsCount: errors.errorFields.length };

      mutableRefObject.current.tabs = {
        ...mutableRefObject.current.tabs,
        [key]: tabToUpdate
      };
    }
  }, []);

  const handleSubmit = useCallback(() => {
    mutableRefObject.current.submitOnce = true;

    Promise
      .all(Object.keys(mutableRefObject.current.tabs).map((key: string) => handleTabSubmit(key)))
      .then(allValues => {
        if (!allValues.some(values => !values)) {
          handleFinish(Object.assign({}, ...allValues))
        }

        forceUpdate();
      });
  }, [forceUpdate, handleTabSubmit, handleFinish]);

  const handleFormValuesChange = useCallback(() => {
    if (mutableRefObject.current.submitOnce) {
      Promise.all(Object.keys(mutableRefObject.current.tabs).map((key: string) => handleTabSubmit(key))).then(() => forceUpdate());
    }
  }, [forceUpdate, handleTabSubmit]);

  return (
    <>
      <div className="flex-grow">
        <Tabs defaultActiveKey="config" type="card" size="middle" className="form-tabs">
          {
            Object.keys(mutableRefObject.current.tabs).map(key => {
              const { form, getComponent } = mutableRefObject.current.tabs[key];

              return (
                <React.Fragment key={key}>
                  <Tabs.TabPane tab={sourceFormCleanFunctions.getTabName(mutableRefObject.current.tabs[key])} key={key} forceRender>
                    <Form form={form} name={`form-${key}`} onValuesChange={handleFormValuesChange}>{getComponent(form)}</Form>
                  </Tabs.TabPane>
                </React.Fragment>
              );
            })
          }
        </Tabs>
      </div>

      <div className="flex-shrink border-t pt-2">
        <Popover
          content={sourceFormCleanFunctions.getErrors(mutableRefObject.current.tabs)}
          title={`${capitalize(formMode)} source form errors:`}
          trigger="click"
          visible={mutableRefObject.current.submitOnce && sourceFormCleanFunctions.getErrorsCount(mutableRefObject.current.tabs) > 0}
        >
          <Button
            key="pwd-login-button"
            type="primary"
            htmlType="button"
            size="large"
            className="mr-3"
            loading={isRequestPending}
            onClick={handleSubmit}
          >
            <span style={{ textTransform: 'capitalize' }}>{formMode}</span>&nbsp;source
          </Button>
        </Popover>

        <Button
          size="large"
          className="mr-3"
          type="dashed"
          loading={connectionTestPending}
          onClick={handleTestConnectionClick}
          icon={<ApiOutlined/>}
        >Test connection</Button>
      </div>
    </>
  );
};

SourceForm.displayName = 'SourceForm';

export { SourceForm };
