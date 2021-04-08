// @Libs
import React from 'react';
import { Col, Form, Input, Row } from 'antd';
// @Components
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
// @Types
import { Parameter } from '@catalog/sources/types';
import { Props } from './ConfigurableFieldsForm.types';

const ConfigurableFieldsForm = ({ fieldsParamsList }: Props) => {
  return (
    <>
      {
        fieldsParamsList.map((param: Parameter) => {
          const { id, documentation, displayName } = param;
          console.log('param: ', param);

          return (
            <Row key={id}>
              <Col span={16}>
                <Form.Item
                  className="form-field_fixed-label"
                  name={id}
                  label={
                    documentation ?
                      <LabelWithTooltip documentation={documentation} render={displayName} /> :
                      <span>{displayName}:</span>
                  }
                  labelCol={{ span: 6 }}
                  wrapperCol={{ span: 18 }}
                >
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          );
        })
      }
    </>
  );
};

ConfigurableFieldsForm.displayName = 'ConfigurableFieldsForm';

export { ConfigurableFieldsForm };
