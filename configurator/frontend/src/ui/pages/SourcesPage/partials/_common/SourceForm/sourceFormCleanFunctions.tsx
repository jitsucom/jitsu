// @Libs
import React from 'react';
import { snakeCase } from 'lodash';
// @Utils
import { naturalSort } from '@util/Array';
// @Types
import { SourceConnector } from '@catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

export interface Tab {
  name: string;
  form: FormInstance;
  getComponent: (form: FormInstance) => JSX.Element;
  errorsCount: number;
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
    : <span className="tab-name tab-name_error">{currentTab.name} <sup>{currentTab.errorsCount}</sup></span>,
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
    : snakeCase(sourceConnector.id)
};

export { sourceFormCleanFunctions };
