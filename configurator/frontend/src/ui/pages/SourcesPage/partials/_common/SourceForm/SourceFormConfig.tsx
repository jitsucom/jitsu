// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Form, Input, message } from 'antd';
import { get, snakeCase } from 'lodash';
// @Utils
import { naturalSort } from '@util/Array';
// Components
import { handleError } from '../../../../../../lib/components/components';
import { SourceFormConfigField } from './SourceFormConfigField';
// @Types
import { RuleObject } from 'rc-field-form/lib/interface';
import { Parameter } from '@connectors/types';
import { SourceFormConfigProps as Props } from './SourceForm.types';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Icons
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';

const SourceFormConfig = ({ alreadyExistSources, connectorSource, initialValues }: Props) => {
  const [connectionTestPending, setConnectionTestPending] = useState<boolean>();

  const services = useMemo(() => ApplicationServices.get(), []);

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

  const handleClick = useCallback(async() => {
    setConnectionTestPending(true);

    try {
      await services.backendApiClient.post('sources/test', {});

      message.success('Successfully connected!');
    } catch (error) {
      handleError(error, 'Unable to test connection with filled data');
    } finally {
      setConnectionTestPending(false);
    }
  }, [services]);

  const validateUniqueSourceId = useCallback((rule: RuleObject, value: string) => Object.keys(alreadyExistSources).find((source) => source === value)
    ? Promise.reject('Source ID must be unique!')
    : Promise.resolve(), [])

  return (
    <>
      <h3>Source ID</h3>
      <Form.Item
        initialValue={initialSourceId}
        className="form-field_fixed-label"
        label={<span className="field-label">SourceId:</span>}
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
      >
        <Input />
      </Form.Item>

      <h3>Config</h3>
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

      <Button className="fields-group" type="dashed" onClick={handleClick} loading={connectionTestPending} icon={<ApiOutlined />}>Test connection</Button>
    </>
  );
};

SourceFormConfig.displayName = 'SourceFormConfig';

export { SourceFormConfig };
