// @Libs
import { useCallback, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
// @Types
import { SourceConnector as CatalogSourceConnector } from 'catalog/sources/types';
import { UpdateConfigurationFields } from './SourceEditor';
// @Components
import { SourceEditorFormConfigurationConfigurableFields } from './SourceEditorFormConfigurationConfigurableFields';
import { SourceEditorFormConfigurationLoadableFields } from './SourceEditorFormConfigurationLoadableFields';
import { SourceEditorFormConfigurationStaticFields } from './SourceEditorFormConfigurationStaticFields';

type Props = {
  initialSourceDataFromBackend: Optional<SourceData>;
  sourceDataFromCatalog: CatalogSourceConnector;
  onChange: UpdateConfigurationFields;
};

type ConfigState = {
  staticFieldsValues: StaticFieldsValues;
  configurableFieldsValues: PlainObjectWithPrimitiveValues;
  loadableFiedsValues: PlainObjectWithPrimitiveValues;
};

type StaticFieldsValues = {
  sourceId: string;
  sourceName: string;
  schedule: string;
};

export type UpdateConfigStaticFieldsValues = (
  values: StaticFieldsValues
) => void;
export type UpdateConfigConfigurableFieldsValues = (
  values: PlainObjectWithPrimitiveValues
) => void;
export type UpdateConfigLoadableFieldsValues = (
  values: PlainObjectWithPrimitiveValues
) => void;

const initialState: ConfigState = {
  staticFieldsValues: {
    sourceId: '',
    sourceName: '',
    schedule: ''
  },
  configurableFieldsValues: {},
  loadableFiedsValues: {}
};

const configStateToSourceConfig = (
  state: ConfigState
): SourceConfigurationData => {
  return Object.values(state).reduce<SourceConfigurationData>(
    (result, current) => ({ ...result, ...current }),
    {}
  );
};

const SourceEditorFormConfiguration: React.FC<Props> = ({
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  onChange
}) => {
  const staticFieldsInitialValues = useMemo<StaticFieldsValues>(
    () => ({
      sourceId: initialSourceDataFromBackend?.sourceId,
      sourceName: initialSourceDataFromBackend?.sourceName,
      schedule: initialSourceDataFromBackend?.schedule
    }),
    []
  );

  const [configState, setConfigState] = useState<ConfigState>({
    staticFieldsValues: staticFieldsInitialValues,
    configurableFieldsValues: {},
    loadableFiedsValues: {}
  });

  const handleChangeStaticValues = useCallback<UpdateConfigStaticFieldsValues>(
    (values: StaticFieldsValues) => {
      debugger;
      let newConfigState: ConfigState = configState;
      setConfigState((configState) => {
        newConfigState = { ...configState, staticFieldsValues: values };
        return newConfigState;
      });
      onChange({ config: configStateToSourceConfig(newConfigState) });
    },
    []
  );

  const handleChangeConfigurableValues =
    useCallback<UpdateConfigConfigurableFieldsValues>(
      (values: PlainObjectWithPrimitiveValues) => {
        let newConfigState: ConfigState = configState;
        setConfigState((configState) => {
          newConfigState = { ...configState, configurableFieldsValues: values };
          return newConfigState;
        });
        onChange({ config: configStateToSourceConfig(newConfigState) });
      },
      []
    );

  const handleChangeLoadableValues =
    useCallback<UpdateConfigLoadableFieldsValues>(
      (values: PlainObjectWithPrimitiveValues) => {
        let newConfigState: ConfigState = configState;
        setConfigState((configState) => {
          newConfigState = { ...configState, loadableFiedsValues: values };
          return newConfigState;
        });
        onChange({ config: configStateToSourceConfig(newConfigState) });
      },
      []
    );

  debugger;

  return (
    <>
      <SourceEditorFormConfigurationStaticFields
        initialValues={staticFieldsInitialValues}
        onChange={handleChangeStaticValues}
      />
      <SourceEditorFormConfigurationConfigurableFields
        onChange={handleChangeConfigurableValues}
      />
      <SourceEditorFormConfigurationLoadableFields
        onChange={handleChangeLoadableValues}
      />
    </>
  );
};

const Wrapped = observer(SourceEditorFormConfiguration);

Wrapped.displayName = 'SourceEditorFormConfiguration';

export { Wrapped as SourceEditorFormConfiguration };
