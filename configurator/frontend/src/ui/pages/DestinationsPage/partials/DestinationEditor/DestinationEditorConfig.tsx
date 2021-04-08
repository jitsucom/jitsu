// @Libs
import React from 'react';
import { Form } from 'antd';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
// @Types
import { Props } from './DestinationEditor.types';

const DestinationEditorConfig = ({ destination }: Props) => {
  const [form] = Form.useForm();

  return(
    <Form name="destination-config" form={form}>
      <ConfigurableFieldsForm fieldsParamsList={destination.parameters} />
    </Form>
  )
};

DestinationEditorConfig.displayName = 'DestinationEditorConfig';

export { DestinationEditorConfig };
