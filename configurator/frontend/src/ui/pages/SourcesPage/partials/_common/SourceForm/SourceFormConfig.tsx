// @Libs
import React, { useCallback, useMemo } from 'react';
import { Col, Form, Input, Row } from 'antd';
import { get, snakeCase } from 'lodash';
// @Utils
import { naturalSort } from '@util/Array';
import { SourceFormConfigField } from './SourceFormConfigField';
// @Types
import { RuleObject } from 'rc-field-form/lib/interface';
import { Parameter } from '@connectors/types';
import { SourceFormConfigProps as Props } from './SourceForm.types';

const SourceFormConfig = ({ alreadyExistSources, connectorSource, initialValues }: Props) => {

  const isUniqueSourceId = useCallback((sourceId: string) => !Object.keys(alreadyExistSources).includes(sourceId), [
    alreadyExistSources
  ]);

  const initialSourceId = useMemo(() => {
    if (initialValues.sourceId) {
      return initialValues.sourceId;
    }

    const preparedBlank = snakeCase(connectorSource.displayName);

    if (isUniqueSourceId(preparedBlank)) {
      return preparedBlank;
    }

    const maxIndexSourceId = naturalSort(
      Object.keys(alreadyExistSources).filter((key: string) => key.includes(preparedBlank))
    )?.pop();

    if (!maxIndexSourceId) {
      return preparedBlank;
    }

    const sourceIdParts = maxIndexSourceId.split('_');
    let sourceIdTail = parseInt(sourceIdParts[sourceIdParts.length - 1]);

    if (isNaN(sourceIdTail)) {
      sourceIdParts[sourceIdParts.length] = '1';
    } else {
      sourceIdTail++;
      sourceIdParts[sourceIdParts.length - 1] = sourceIdTail;
    }

    return sourceIdParts.join('_');
  }, [alreadyExistSources, isUniqueSourceId, initialValues, connectorSource]);

  const validateUniqueSourceId = useCallback((rule: RuleObject, value: string) => Object.keys(alreadyExistSources).find((source) => source === value)
    ? Promise.reject('Source ID must be unique!')
    : Promise.resolve(), [alreadyExistSources])

  return (
    <>
      <Row>
        <Col span={16}>
          <Form.Item
            initialValue={initialSourceId}
            className="form-field_fixed-label"
            label={<span>SourceId:</span>}
            name="sourceId"
            rules={[
              {
                required: true,
                message: 'Source ID is required field'
              },
              {
                validator: validateUniqueSourceId
              }
            ]}
            labelCol={{ span: 6 }}
            wrapperCol={{ span: 18 }}
          >
            <Input />
          </Form.Item>
        </Col>
      </Row>

      {connectorSource.configParameters.map(({ id, displayName, required, type, documentation }: Parameter) => (
        <SourceFormConfigField
          type={type.typeName}
          id={id}
          key={id}
          displayName={displayName}
          initialValue={get(initialValues, `config.${id}`)}
          required={required}
          documentation={documentation}
        />
      ))}
    </>
  );
};

SourceFormConfig.displayName = 'SourceFormConfig';

export { SourceFormConfig };
