import { SourceConnector } from 'catalog/sources/types';
import { context } from 'rc-image/lib/PreviewGroup';
import React, { Dispatch, SetStateAction, useContext, useState } from 'react';

type ThrowError = (...args: unknown[]) => never;

type ReactSetState<T> = Dispatch<SetStateAction<T>>;

type ContextParams = {
  /**
   * if you to delete this parameter, please, change the assertion condition in `assertContextIsValid`;
   */
  isLoadingConfigParameters: boolean;
  setIsLoadingConfigParameters: ReactSetState<boolean>;
};

const SourceEditorSyncContext = React.createContext<Partial<ContextParams>>({});

function assertContextIsValid(
  context: Partial<ContextParams>
): asserts context is ContextParams {
  if (typeof context.isLoadingConfigParameters === 'undefined')
    throwErrorOutOfContext();
}

const throwErrorOutOfContext: ThrowError = () => {
  throw new Error(
    'attempted to use SourceEditorSyncContext outside of the context'
  );
};

type ContextProps = {
  connectorSource: SourceConnector;
};

export const WithSourceEditorSyncContext: React.FC<ContextProps> = ({
  children,
  connectorSource
}) => {
  const [isLoadingConfigParameters, setIsLoadingConfigParameters] =
    useState<boolean>(connectorSource.hasLoadableConfigParameters);
  return (
    <SourceEditorSyncContext.Provider
      value={{
        isLoadingConfigParameters,
        setIsLoadingConfigParameters
      }}
    >
      {children}
    </SourceEditorSyncContext.Provider>
  );
};

export const useSourceEditorSyncContext = () => {
  const context = useContext(SourceEditorSyncContext);
  assertContextIsValid(context);
  return context;
};
