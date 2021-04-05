// @Libs
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Prompt, useHistory } from 'react-router-dom';
import { Popover, Button, Form, message, Tabs } from 'antd';
import { capitalize, snakeCase } from 'lodash';
// @Types
import { FormProps as Props } from './SourceForm.types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
// @Components
import { handleError } from '@./lib/components/components';
import { SourceFormConfig } from './SourceFormConfig';
import { SourceFormCollections } from './SourceFormCollections';
import { SourceFormDestinations } from './SourceFormDestinations';
// @Icons
import CloseOutlined from '@ant-design/icons/lib/icons/CloseOutlined';
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Hooks
import { useForceUpdate } from '@hooks/useForceUpdate';
// @Routes
import { routes } from '@page/SourcesPage/routes';
// @Styles
import styles from './SourceForm.module.less';
import { makeObjectFromFieldsValues } from '@util/Form';

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
  getErrors: (tabs: TabsMap, tabsKeys: string[]) => (<ul>
    {tabsKeys.reduce((result: React.ReactNode[], key: string) => {
      if (tabs[key].errorsCount > 0) {
        result.push(<li key={key}>{tabs[key].errorsCount} error(s) at `{tabs[key].name}` tab;</li>)
      }

      return result;
    }, [])}
  </ul>),
  getTabName: (currentTab: Tab) => currentTab.errorsCount === 0
    ? currentTab.name
    : <span className="tab-name tab-name_error">{currentTab.name} <sup>{currentTab.errorsCount}</sup></span>
};

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  sources,
  initialValues = {},
  formMode
}: Props) => {
  const history = useHistory();

  const forceUpdate = useForceUpdate();

  const [changedAndUnsavedFields, setChangedAndUnsavedFields] = useState<boolean>();
  const [isVisiblePopover, switchIsVisiblePopover] = useState<boolean>(false);
  const [isVisibleTestConnectionPopover, switchIsVisibleTestConnectionPopover] = useState<boolean>(false);
  const [connectionTestPending, setConnectionTestPending] = useState<boolean>(false);

  const mutableRefObject = useRef<{ tabs: TabsMap; submitOnce: boolean; connectedOnce: boolean; }>({
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
        getComponent: (form: FormInstance) => <SourceFormCollections reportPrefix={connectorSource.id} initialValues={initialValues} connectorSource={connectorSource} form={form} />,
        errorsCount: 0
      },
      destinations: {
        name: 'Destinations',
        form: Form.useForm()[0],
        getComponent: (form: FormInstance) => <SourceFormDestinations initialValues={initialValues} form={form} />,
        errorsCount: 0
      }
    },
    submitOnce: false,
    connectedOnce: false
  });

  const services = useMemo(() => ApplicationServices.get(), []);

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

      throw errors;
    }
  }, []);

  const handleFormSubmit = useCallback(() => {
    switchIsVisiblePopover(true);

    mutableRefObject.current.submitOnce = true;

    Promise
      .all(Object.keys(mutableRefObject.current.tabs).map((key: string) => handleTabSubmit(key)))
      .then(allValues => {
        if (!allValues.some(values => !values)) {
          handleFinish(Object.assign({}, ...allValues));

          setChangedAndUnsavedFields(false);
        }
      })
      .finally(() => {
        forceUpdate();
      });
  }, [forceUpdate, handleTabSubmit, handleFinish]);

  const handleFormValuesChange = useCallback(() => {
    if (!changedAndUnsavedFields) {
      setChangedAndUnsavedFields(true);
    }

    if (mutableRefObject.current.submitOnce) {
      Promise.all(Object.keys(mutableRefObject.current.tabs).map((key: string) => handleTabSubmit(key))).then(() => forceUpdate());
    } else if (mutableRefObject.current.connectedOnce) {
      handleTabSubmit('config').then(() => forceUpdate());
    }
  }, [changedAndUnsavedFields, forceUpdate, handleTabSubmit]);

  const handleCancel = useCallback(() => history.push(routes.root), [history]);

  const handlePopoverClose = useCallback(() => switchIsVisiblePopover(false), []);
  const handleTestConnectionPopoverClose = useCallback(() => switchIsVisibleTestConnectionPopover(false), []);

  const handleTestConnectionClick = useCallback(async() => {
    setConnectionTestPending(true);

    mutableRefObject.current.connectedOnce = true;

    try {
      await handleTabSubmit('config');

      try {
        const { form } = mutableRefObject.current.tabs.config;
        const configObjectValues = makeObjectFromFieldsValues<Partial<SourceData>>(form.getFieldsValue());

        await services.backendApiClient.post('sources/test', { ...configObjectValues, sourceType: snakeCase(connectorSource.id) });

        message.success('Successfully connected!');
      } catch(e) {
        handleError(e, 'Service is temporary unavailable');
      }
    } catch (error) {
      handleError(error, 'Unable to test connection with filled data');
    } finally {
      setConnectionTestPending(false);
    }
  }, [connectorSource, handleTabSubmit, services]);

  return (
    <>
      <div className="flex-grow">
        <Tabs defaultActiveKey="config" type="card" size="middle" className={styles.sourceTabs}>
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
          content={sourceFormCleanFunctions.getErrors(mutableRefObject.current.tabs, Object.keys(mutableRefObject.current.tabs))}
          title={<p className={styles.popoverTitle}><span>{capitalize(formMode)} source form errors:</span> <CloseOutlined onClick={handlePopoverClose} /></p>}
          trigger="click"
          visible={isVisiblePopover && sourceFormCleanFunctions.getErrorsCount(mutableRefObject.current.tabs) > 0}
        >
          <Button
            key="pwd-login-button"
            type="primary"
            htmlType="button"
            size="large"
            className="mr-3"
            loading={isRequestPending}
            onClick={handleFormSubmit}
          >
            <span style={{ textTransform: 'capitalize' }}>{formMode}</span>&nbsp;source
          </Button>
        </Popover>

        <Popover
          content={sourceFormCleanFunctions.getErrors(mutableRefObject.current.tabs, ['config'])}
          title={<p className={styles.popoverTitle}><span>Config form errors:</span> <CloseOutlined onClick={handleTestConnectionPopoverClose} /></p>}
          trigger="click"
          visible={isVisibleTestConnectionPopover && mutableRefObject.current.tabs.config.errorsCount > 0}
        >
          <Button
            size="large"
            className="mr-3"
            type="dashed"
            loading={connectionTestPending}
            onClick={handleTestConnectionClick}
            icon={<ApiOutlined/>}
          >Test connection</Button>
        </Popover>

        <Button
          type="default"
          size="large"
          onClick={handleCancel}
          danger>Cancel</Button>
      </div>

      <Prompt message={() => {
        if (changedAndUnsavedFields) {
          return 'You have unsaved changes. Are you sure you want to leave the page?'
        }
      }}/>
    </>
  );
};

SourceForm.displayName = 'SourceForm';

export { SourceForm };
