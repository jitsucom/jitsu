// @Libs
import React from 'react';
import { Form } from 'antd';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
// @Types
import { Props } from './DestinationEditor.types';

const DestinationEditorConfig = ({ destination, form }: Props) => {
  return(
    <Form name="destination-config" form={form} autoComplete="off">
      <ConfigurableFieldsForm fieldsParamsList={destination.parameters} form={form} />
    </Form>
  )
};

DestinationEditorConfig.displayName = 'DestinationEditorConfig';

export { DestinationEditorConfig };
