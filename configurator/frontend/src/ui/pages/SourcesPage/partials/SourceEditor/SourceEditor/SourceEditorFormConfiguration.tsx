import { useCallback, useState } from 'react';
import { UpdateConfigurationFields } from './SourceEditor';
import { SourceEditorFormConfigurationConfigurableFields } from './SourceEditorFormConfigurationConfigurableFields';
import { SourceEditorFormConfigurationLoadableFields } from './SourceEditorFormConfigurationLoadableFields';
import { SourceEditorFormConfigurationStaticFields } from './SourceEditorFormConfigurationStaticFields';

type Props = {
  onChange: UpdateConfigurationFields;
};

type State = {
  staticFieldsValues: unknown;
  configurableFieldsValues: unknown;
  loadableFiedsValues: unknown;
};

export type UpdateConfigStaticFieldsValues = (values: unknown) => void;
export type UpdateConfigConfigurableFieldsValues = (values: unknown) => void;
export type UpdateConfigLoadableFieldsValues = (values: unknown) => void;

const initialState: State = {
  staticFieldsValues: {},
  configurableFieldsValues: {},
  loadableFiedsValues: {}
};

export const SourceEditorFormConfiguration: React.FC<Props> = ({
  onChange
}) => {
  const [state, setState] = useState<State>(initialState);

  const handleChangeStaticValues = useCallback<UpdateConfigStaticFieldsValues>(
    (values: unknown) => {
      let newState: State = state;
      setState((state) => {
        newState = { ...state, staticFieldsValues: values };
        return newState;
      });
      onChange({ config: newState });
    },
    []
  );

  const handleChangeConfigurableValues =
    useCallback<UpdateConfigConfigurableFieldsValues>((values: unknown) => {
      let newState: State = state;
      setState((state) => {
        newState = { ...state, staticFieldsValues: values };
        return newState;
      });
      onChange({ config: newState });
    }, []);

  const handleChangeLoadableValues =
    useCallback<UpdateConfigLoadableFieldsValues>((values: unknown) => {
      let newState: State = state;
      setState((state) => {
        newState = { ...state, staticFieldsValues: values };
        return newState;
      });
      onChange({ config: newState });
    }, []);

  return (
    <>
      <SourceEditorFormConfigurationStaticFields
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
