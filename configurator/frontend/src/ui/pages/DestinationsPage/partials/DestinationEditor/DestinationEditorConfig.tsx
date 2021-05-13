// @Libs
import React from 'react';
import { Form } from 'antd';
import debounce from 'lodash/debounce';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
// @Types
import { Destination } from '@catalog/destinations/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

export interface Props {
  destinationData: DestinationData;
  destinationReference: Destination;
  form: FormInstance;
  handleTouchAnyField: VoidFunc;
}

const DestinationEditorConfig = ({ destinationData, destinationReference, form, handleTouchAnyField }: Props) => {
  const handleChange = debounce(handleTouchAnyField, 500);

  return (
    <Form
      name="destination-config"
      form={form}
      autoComplete="off"
      onChange={handleChange}
    >
      <ConfigurableFieldsForm
        handleTouchAnyField={handleTouchAnyField}
        fieldsParamsList={destinationReference.parameters}
        form={form}
        initialValues={destinationData}
      />
    </Form>
  )
};

DestinationEditorConfig.displayName = 'DestinationEditorConfig';

export { DestinationEditorConfig };
