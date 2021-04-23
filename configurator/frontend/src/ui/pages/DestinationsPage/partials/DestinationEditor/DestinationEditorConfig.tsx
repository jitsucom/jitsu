// @Libs
import React, { useCallback } from 'react';
import { Form } from 'antd';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
// @Types
import { Destination } from '@catalog/destinations/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

export interface Props {
  destinationData: DestinationData;
  destinationReference: Destination;
  form: FormInstance;
  handleTouchAnyField: (value: boolean) => void;
}

const DestinationEditorConfig = ({ destinationData, destinationReference, form, handleTouchAnyField }: Props) => {
  const handleSomeFieldChange = useCallback(() => handleTouchAnyField(true), [handleTouchAnyField]);

  return (
    <Form
      name="destination-config"
      form={form}
      autoComplete="off"
      onChange={handleSomeFieldChange}
    >
      <ConfigurableFieldsForm initialValues={destinationData} fieldsParamsList={destinationReference.parameters} form={form}/>
    </Form>
  )
};

DestinationEditorConfig.displayName = 'DestinationEditorConfig';

export { DestinationEditorConfig };
