// @Libs
import React, { useCallback } from 'react';
import { Form } from 'antd';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
// @Types
import { Destination } from '@catalog/destinations/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

const initialValues = {
  '_formData.pghost': 'ec2-34-194-198-238.compute-1.amazonaws.com',
  '_formData.pgdatabase': 'd1p1tiidq6d6b7',
  '_formData.pgschema': 'ksense',
  '_formData.pguser': 'yjnjwapyryobyp',
  '_formData.pgpassword': '8bc09f6ef6666890f14368ad9cd2b2d602006531a305e3c0fb84289329d56375'
};

export interface Props {
  destination: Destination;
  form: FormInstance;
  handleTouchAnyField: (value: boolean) => void;
}

const DestinationEditorConfig = ({ destination, form, handleTouchAnyField }: Props) => {
  const handleSomeFieldChange = useCallback(() => handleTouchAnyField(true), [handleTouchAnyField]);

  return (
    <Form
      name="destination-config"
      form={form}
      autoComplete="off"
      onChange={handleSomeFieldChange}
      initialValues={initialValues}
    >
      <ConfigurableFieldsForm fieldsParamsList={destination.parameters} form={form}/>
    </Form>
  )
};

DestinationEditorConfig.displayName = 'DestinationEditorConfig';

export { DestinationEditorConfig };
