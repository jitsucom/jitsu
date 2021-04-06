// @Libs
import React from 'react';
import { snakeCase } from 'lodash';
// @Utils
import { naturalSort } from '@util/Array';
// @Types
import { SourceConnector } from '@catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import ApplicationServices from '@service/ApplicationServices';
import { Button, message } from 'antd';

export interface Tab {
  name: string;
  form: FormInstance;
  getComponent: (form: FormInstance) => JSX.Element;
  errorsCount: number;
  warningsCount?: number;
  isHiddenTab?: boolean;
}

export interface TabsMap {
  [key: string]: Tab;
}

const sourceFormCleanFunctions = {
  getErrorsCount: (tabs: TabsMap) => Object.keys(tabs).reduce((result: number, key: string) => {
    result += tabs[key].errorsCount;
    return result;
  }, 0),

  getErrorsAndWarnings: (tabs: TabsMap, tabsKeys: string[]) => (<ul>
    {tabsKeys.reduce((result: React.ReactNode[], key: string) => {
      if (tabs[key].errorsCount > 0 || tabs[key].warningsCount > 0) {
        const messages = [];

        if (tabs[key].errorsCount > 0) {
          messages.push(`${tabs[key].errorsCount} error(s)`)
        }

        if (tabs[key].warningsCount > 0) {
          messages.push(`${tabs[key].warningsCount} warning(s)`)
        }

        result.push(<li key={key}>{messages.join(' and ')} at `{tabs[key].name}` tab;</li>)
      }

      return result;
    }, [])}
  </ul>),

  getTabName: (currentTab: Tab) => currentTab.errorsCount > 0
    ? <span className="tab-name tab-name_error">{currentTab.name} <sup>{currentTab.errorsCount}</sup></span>
    : currentTab.warningsCount > 0
      ? <span className="tab-name tab-name_warning">{currentTab.name} <sup>{currentTab.warningsCount}</sup></span>
      : currentTab.name,

  getUniqueAutoIncremented: (alreadyExists: string[], blank: string, separator: string = '_') => {
    if (!alreadyExists.some(someValue => blank === someValue)) {
      return blank;
    }

    const maxIndex = naturalSort(alreadyExists)?.pop()

    if (!maxIndex) {
      return blank;
    }

    const divided = maxIndex.split(separator);

    let tail = parseInt(divided[divided.length - 1]);

    if (isNaN(tail)) {
      divided[divided.length] = '1';
    } else {
      tail++;
      divided[divided.length - 1] = tail;
    }

    return divided.join('_');
  },
  getSourceType: (sourceConnector: SourceConnector) => sourceConnector.isSingerType
    ? 'singer'
    : snakeCase(sourceConnector.id),

  testConnection: async(config: any, connectorSource: any) => {
    return ApplicationServices
      .get()
      .backendApiClient
      .post('sources/test', { ...config, sourceType: sourceFormCleanFunctions.getSourceType(connectorSource) })
      .then(() => {
        message.success('Successfully connected!');

        return true;
      })
      .catch(error => {
        message.error(
          <>
            <b>Unable to establish connection</b> - {error.message}
            <Button type="link" onClick={() => message.destroy()}>
              <span className="border-b border-primary border-dashed">Close</span>
            </Button>
          </>, 0);

        return false;
      })
  }
};

export { sourceFormCleanFunctions };
