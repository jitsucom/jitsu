// @Libs
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
// @Types
import { SourceConnector as CatalogSourceConnector } from 'catalog/sources/types';
import { UpdateConfigurationFields } from './SourceEditor';
// @Components
import { SourceEditorFormConfigurationStaticFields } from './SourceEditorFormConfigurationStaticFields';
import { SourceEditorFormConfigurationConfigurableLoadableFields } from './SourceEditorFormConfigurationConfigurableLoadableFields';

type Props = {
  editorMode: 'add' | 'edit';
  initialSourceDataFromBackend: Optional<Partial<SourceData>>;
  sourceDataFromCatalog: CatalogSourceConnector;
  onChange: UpdateConfigurationFields;
  setValidator: (validator: () => Promise<number>) => void;
};

export type ValidateGetErrorsCount = () => Promise<number>;
const initialValidator: () => ValidateGetErrorsCount = () => async () => 0;

const SourceEditorFormConfiguration: React.FC<Props> = ({
  editorMode,
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  onChange,
  setValidator
}) => {
  const [staticFieldsValidator, setStaticFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator);
  const [
    configurableLoadableFieldsValidator,
    setConfigurableLoadableFieldsValidator
  ] = useState<ValidateGetErrorsCount>(initialValidator);

  useEffect(() => {
    const validateConfigAndCountErrors = async (): Promise<number> => {
      const staticFieldsErrorsCount = await staticFieldsValidator();
      const configurableLoadableFieldsErrorsCount =
        await configurableLoadableFieldsValidator();
      return staticFieldsErrorsCount + configurableLoadableFieldsErrorsCount;
    };

    setValidator(validateConfigAndCountErrors);
  }, [staticFieldsValidator, configurableLoadableFieldsValidator]);

  return (
    <>
      <SourceEditorFormConfigurationStaticFields
        editorMode={editorMode}
        initialValues={initialSourceDataFromBackend}
        onChange={onChange}
        setValidator={setStaticFieldsValidator}
      />
      <SourceEditorFormConfigurationConfigurableLoadableFields
        initialValues={initialSourceDataFromBackend}
        sourceDataFromCatalog={sourceDataFromCatalog}
        onChange={onChange}
        setValidator={setConfigurableLoadableFieldsValidator}
      />
    </>
  );
};

const Wrapped = observer(SourceEditorFormConfiguration);

Wrapped.displayName = 'SourceEditorFormConfiguration';

export { Wrapped as SourceEditorFormConfiguration };
