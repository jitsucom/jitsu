// @Libs
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Prompt, useHistory, useParams } from 'react-router-dom';
import { Popover, Button, Form, message, Tabs } from 'antd';
import { capitalize } from 'lodash';
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
// @Utils
import { makeObjectFromFieldsValues } from '@util/forms/marshalling';
import { sourceFormCleanFunctions, TabsMap } from './sourceFormCleanFunctions';

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  sources,
  initialValues = {},
  formMode,
  setConnected
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
        getComponent: () => <SourceFormConfig initialValues={initialValues} connectorSource={connectorSource} sources={sources} isCreateForm={formMode === 'create'}/>,
        errorsCount: 0
      },
      collections: {
        name: 'Collections',
        form: Form.useForm()[0],
        getComponent: (form: FormInstance) => <SourceFormCollections reportPrefix={connectorSource.id} initialValues={initialValues} connectorSource={connectorSource} form={form}/>,
        errorsCount: 0,
        isHiddenTab: connectorSource.isSingerType
      },
      destinations: {
        name: 'Destinations',
        form: Form.useForm()[0],
        getComponent: (form: FormInstance) => <SourceFormDestinations initialValues={initialValues} form={form}/>,
        errorsCount: 0
      }
    },
    submitOnce: false,
    connectedOnce: false
  });

  const handleTabSubmit = useCallback(async(key: string) => {
    const currentTab = mutableRefObject.current.tabs[key];

    if (key === 'destinations') {
      const destinations = currentTab.form.getFieldsValue()?.destinations;

      if (!destinations || !destinations.length) {
        mutableRefObject.current.tabs = {
          ...mutableRefObject.current.tabs,
          [key]: {
            ...mutableRefObject.current.tabs[key],
            warningsCount: 1
          }
        };
      }

      forceUpdate();
    }

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
  }, [forceUpdate]);

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
      .finally(forceUpdate);
  }, [forceUpdate, handleTabSubmit, handleFinish]);

  const handleFormValuesChange = useCallback(() => {
    if (!changedAndUnsavedFields) {
      setChangedAndUnsavedFields(true);
    }

    if (mutableRefObject.current.submitOnce) {
      Promise.all(Object.keys(mutableRefObject.current.tabs).map((key: string) => handleTabSubmit(key))).finally(forceUpdate);
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

      const { form } = mutableRefObject.current.tabs.config;
      const configObjectValues = makeObjectFromFieldsValues<Partial<SourceData>>(form.getFieldsValue());
      const connected = await sourceFormCleanFunctions.testConnection(configObjectValues, connectorSource);

      if (connected) {
        setConnected(connected);
      }
    } catch (error) {
      handleError(error, 'Unable to test connection with filled data');
    } finally {
      setConnectionTestPending(false);
    }
  }, [setConnected, connectorSource, handleTabSubmit]);

  const params = useParams<{ tabName: string, sourceId: string }>();

  return (
    <>
      <div className="flex-grow">
        <Tabs defaultActiveKey={params.tabName || 'config'} type="card" size="middle" className={styles.sourceTabs}
          onChange={(tab) => {
            if (params.sourceId) {
              history.replace(`/sources/edit/${params.sourceId}/${tab}`)
            }
          }}>
          {
            Object.keys(mutableRefObject.current.tabs).map(key => {
              const { form, getComponent, isHiddenTab } = mutableRefObject.current.tabs[key];

              return !isHiddenTab
                ? (
                  <React.Fragment key={key}>
                    <Tabs.TabPane tab={sourceFormCleanFunctions.getTabName(mutableRefObject.current.tabs[key])} key={key} forceRender>
                      <Form form={form} name={`form-${key}`} onValuesChange={handleFormValuesChange}>{getComponent(form)}</Form>
                    </Tabs.TabPane>
                  </React.Fragment>
                )
                : null;
            })
          }
        </Tabs>
      </div>

      <div className="flex-shrink border-t pt-2">
        <Popover
          content={sourceFormCleanFunctions.getErrorsAndWarnings(mutableRefObject.current.tabs, Object.keys(mutableRefObject.current.tabs))}
          title={<p className={styles.popoverTitle}><span>{capitalize(formMode)} source form errors:</span> <CloseOutlined onClick={handlePopoverClose}/></p>}
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
            {formMode === 'create'
              ?
              'Create Source'
              :
              'Save Source'}
          </Button>
        </Popover>

        <Popover
          content={sourceFormCleanFunctions.getErrorsAndWarnings(mutableRefObject.current.tabs, ['config'])}
          title={<p className={styles.popoverTitle}><span>Config form errors:</span> <CloseOutlined onClick={handleTestConnectionPopoverClose}/></p>}
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
