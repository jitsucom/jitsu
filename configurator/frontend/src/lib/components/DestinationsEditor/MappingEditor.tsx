/* eslint-disable */
import * as React from 'react';
import { useState } from 'react';
import cloneDeep from 'lodash/cloneDeep';

import { Button, Input, message, Modal, Radio, Select, Table } from 'antd';
import MAPPING_NAMES, { FieldMappings, Mapping } from '../../services/mappings';
import { Align, handleError, LabelWithTooltip } from '../components';
import './MappingEditor.less';

import DeleteFilled from '@ant-design/icons/lib/icons/DeleteFilled';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';

type IMappingEditorProps = {
  entity: FieldMappings;
  onChange: (newEntity: FieldMappings) => Promise<void>;
  closeDialog: () => void;
};

export function MappingEditor({ entity, onChange, closeDialog }: IMappingEditorProps) {
  entity = cloneDeep(entity);
  let rowId = 0;
  let [saving, setSaving] = useState(false);
  let [keepUnknownFields, setKeepUnknownFields] = useState(entity.keepUnmappedFields);
  let [currentMappings, setCurrentMappings] = useState(entity.mappings);
  let jsonPointerValidator = (val: string) => {
    return isValidJsonPointer(val) ? null : 'Invalid JSON pointer syntax. Should be /path/to/element';
  };
  let tableColumns = [
    {
      width: '35%',
      title: (
        <LabelWithTooltip
          documentation={
            <>
              Source field as JSON Pointer.{' '}
              <a
                target="_blank"
                rel="noopener"
                href="https://jitsu.com/docs/configuration/schema-and-mappings#step-3-mapping"
              >
                Read more about mappings
              </a>
            </>
          }
        >
          Source
        </LabelWithTooltip>
      ),
      render: (val, mapping: Mapping, index) => {
        if (mapping == null) {
          return (
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setCurrentMappings([...currentMappings, new Mapping('', '', 'move')]);
              }}
            >
              Add New Field Mapping
            </Button>
          );
        }
        return (
          <JsonPointerInput
            initialValue={mapping.srcField}
            validator={jsonPointerValidator}
            onChange={(val) => (mapping.srcField = val)}
          />
        );
      }
    },
    {
      width: '200px',
      title: <Align horizontal="left">Transformation</Align>,
      render: (val, mapping: Mapping, index) => {
        if (mapping == null) {
          return '';
        }
        return (
          <Align horizontal="center">
            <Select
              dropdownMatchSelectWidth={false}
              className="mapping-editor-select-transform"
              size="small"
              value={mapping.action}
              onChange={(val) => {
                mapping.action = val;
                //don't really update list, just trigger re-render
                setCurrentMappings([...currentMappings]);
              }}
            >
              {Object.entries(MAPPING_NAMES).map(([key, val]) => {
                return (
                  <Select.Option value={key} key={key}>
                    {val}
                  </Select.Option>
                );
              })}
            </Select>
          </Align>
        );
      }
    },
    {
      width: '35%',
      title: (
        <LabelWithTooltip
          documentation={
            <>
              Destination field as JSON Pointer.{' '}
              <a
                target="_blank"
                rel="noopener"
                href="https://jitsu.com/docs/configuration/schema-and-mappings#step-3-mapping"
              >
                Read more about mappings
              </a>
            </>
          }
        >
          Destination
        </LabelWithTooltip>
      ),
      render: (val, mapping: Mapping, index) => {
        if (mapping == null || mapping.action == 'erase') {
          return null;
        }
        return (
          <JsonPointerInput
            initialValue={mapping.dstField}
            validator={jsonPointerValidator}
            onChange={(val) => (mapping.dstField = val)}
          />
        );
      }
    },
    {
      width: '5%',
      title: <Align horizontal="right">Action</Align>,
      render: (val, mapping: Mapping, index) => {
        if (mapping == null) {
          return '';
        }
        return (
          <Align horizontal="right">
            <a
              onClick={() => {
                let newMappings = [...currentMappings];
                newMappings.splice(index, 1);
                setCurrentMappings(newMappings);
              }}
            >
              <DeleteFilled />
            </a>
          </Align>
        );
      }
    }
  ];
  let cancel = () => {
    Modal.confirm({
      title: 'Are you sure?',
      content: 'Changes you made will be lost, are you sure?',
      onOk: () => closeDialog(),
      onCancel: () => {}
    });
  };

  return (
    <Modal
      closable={true}
      keyboard={true}
      maskClosable={true}
      width="70%"
      className="destinations-editor-modal"
      title={'Edit field mappings'}
      visible={true}
      onCancel={cancel}
      footer={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                for (let mapping of currentMappings) {
                  if (
                    !isValidJsonPointer(mapping.srcField) ||
                    (mapping.action !== 'erase' && !isValidJsonPointer(mapping.dstField))
                  ) {
                    message.error('Some mappings has invalid syntax. They are marked in red');
                    return;
                  }
                }
                await onChange(new FieldMappings(currentMappings, keepUnknownFields));
                closeDialog();
              } catch (error) {
                handleError(error, 'Failed to save: ' + error.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="mapping-editor-top-panel">
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          defaultValue={keepUnknownFields ? 'keep' : 'remove'}
          onChange={(value) => {
            setKeepUnknownFields(value.target.value === 'keep');
          }}
        >
          <Radio.Button value="keep">Keep unmapped fields</Radio.Button>
          <Radio.Button value="remove">Remove unmapped fields</Radio.Button>
        </Radio.Group>
        <LabelWithTooltip
          documentation={
            <>If the field doesn't have mapping: Keep - keep field as is, Remove - remove field from original JSON</>
          }
        />
      </div>

      <Table
        size="small"
        pagination={false}
        className="mapping-editor-table"
        columns={tableColumns}
        dataSource={[...(currentMappings ?? []), null]}
        rowKey={(mapping, index) => {
          return String(index + ++rowId);
        }}
      />
    </Modal>
  );
}

function JsonPointerInput(props: {
  initialValue: any;
  onChange: (val: string) => void;
  validator: (val: string) => string;
}) {
  let [error, setError] = useState(props.validator(props.initialValue));
  let onChange = (value) => {
    let val = value.target.value;
    let error = props.validator(val);
    if (error) {
      setError(error);
    } else {
      setError(null);
    }
    props.onChange(val);
  };
  return (
    <>
      <Input
        type="text"
        className="mapping-editor-json-pointer"
        defaultValue={props.initialValue}
        onChange={onChange}
        size="small"
        contentEditable={true}
      />
      <div className="mapping-editor-json-poiter-error">{error ? error : '\u00A0'}</div>
    </>
  );
}

function isValidJsonPointer(val) {
  return val.length > 0 && val[0] === '/' && val[val.length - 1] !== '/' && val.indexOf(' ') < 0;
}
