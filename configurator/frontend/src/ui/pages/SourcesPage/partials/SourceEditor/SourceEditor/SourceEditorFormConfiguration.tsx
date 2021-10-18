// @Libs
import { observer } from 'mobx-react-lite';
// @Types
import { SourceConnector as CatalogSourceConnector } from 'catalog/sources/types';
import { UpdateConfigurationFields } from './SourceEditor';
// @Components
import { SourceEditorFormConfigurationConfigurableLoadableFields } from './SourceEditorFormConfigurationConfigurableLoadableFields';
import { SourceEditorFormConfigurationStaticFields } from './SourceEditorFormConfigurationStaticFields';

type Props = {
  initialSourceDataFromBackend: Optional<SourceData>;
  sourceDataFromCatalog: CatalogSourceConnector;
  onChange: UpdateConfigurationFields;
};

const SourceEditorFormConfiguration: React.FC<Props> = ({
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  onChange
}) => {
  return (
    <>
      <SourceEditorFormConfigurationStaticFields
        initialValues={initialSourceDataFromBackend}
        onChange={onChange}
      />
      <SourceEditorFormConfigurationConfigurableLoadableFields
        initialValues={initialSourceDataFromBackend}
        sourceDataFromCatalog={sourceDataFromCatalog}
        onChange={onChange}
      />
    </>
  );
};

const Wrapped = observer(SourceEditorFormConfiguration);

Wrapped.displayName = 'SourceEditorFormConfiguration';

export { Wrapped as SourceEditorFormConfiguration };
