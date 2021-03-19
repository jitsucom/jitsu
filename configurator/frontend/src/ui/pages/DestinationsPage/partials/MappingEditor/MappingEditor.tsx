/* eslint-disable */
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import cloneDeep from "lodash/cloneDeep";

import { Button, Form, Input, message, Modal, Radio, Select, Table } from "antd";
import MAPPING_NAMES, {
  FieldMappings,
  Mapping,
} from "@./lib/services/mappings";
import {
  Align, CenteredError, CenteredSpin,
  handleError,
  LabelWithTooltip,
} from "@./lib/components/components";
import "./MappingEditor.less";
import PlayCircleFilled from "@ant-design/icons/lib/icons/PlayCircleFilled"
import DeleteFilled from "@ant-design/icons/lib/icons/DeleteFilled";
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined";
import ApplicationServices from "@./lib/services/ApplicationServices";
import { loadDestinations } from "@page/DestinationsPage/commons";
import { useParams, NavLink } from "react-router-dom";
import { DestinationConfig } from "@./lib/services/destinations";
import Marshal from "@./lib/commons/marshalling";
import { FloatingLabelInput } from "@molecule/FloatingLabelInput";

export type MappingEditorProps = {
  mappings: FieldMappings
  onChange: (mappings: FieldMappings, isValid: boolean) => void
}

export function MappingEditor(props: MappingEditorProps) {
  const [mappings, updateMappings] = useState(props.mappings);
  return <div className="px-auto">
    <div className="italic text-secondaryText">
      Mappings defines how the data will be transformed before it landed to destination. The result of
      transformation is an another.
      Read more about <a href="https://jitsu.com/docs/configuration/schema-and-mappings">mappings in documentation</a>.
    </div>
    <div className="bg-bgSecondary rounded-xl mt-4">
      <div className="flex rounded-t-xl items-center py-3 px-5 border-b">
        <LabelWithTooltip className="flex-shrink pr-4" documentation={<>
          Depending on this setting, mapping engine will either keep a field intact if it's not explicitly
          mapped to other field, or remove it <a href="https://jitsu.com/docs/configuration/schema-and-mappings">Read
          more about mappings</a>
        </>}>Unmapped field strategy: </LabelWithTooltip>
        <Select className="w-48" inputValue="keep">
          <Select.Option value="keep">Keep fields</Select.Option>
          <Select.Option value="remove">Remove fields</Select.Option>
        </Select>
        <div className="flex-grow flex justify-end">
          <div>
            <Button icon={<PlayCircleFilled/>}>Test Mapping</Button>
          </div>
        </div>
      </div>
      <div>
        <div key="mappings">
          {mappings.mappings.map((mapping => <MappingLine mapping={mapping}/>))}
        </div>
        <div key="bottomPane" className="py-3 px-5 border-t">
          <Button type="primary" onClick={() => {
            mappings.addMapping(new Mapping("/path/to/field", "/path/to/field2", null))
            updateMappings(mappings);
            props.onChange(mappings, false);
          }}>Add Mapping</Button>
        </div>
      </div>
    </div>
  </div>
}

function MappingLine({ mapping }: { mapping: Mapping }) {
  const [form] = Form.useForm();
  let key = mapping['__rowKey'];
  return <Form key={key} form={form} layout="horizontal" className="flex border-b">
    <FloatingLabelInput name="src" formName={`row_form_${key}`} floatingLabelText="/src/field/path"/>
    <FloatingLabelInput name="dst" formName={`row_form_${key}`} floatingLabelText="/destination/field/path"/>
    <Form.Item name="type">
      <Select>
        {Object.entries(MAPPING_NAMES).map(([optName, displayName]) =>
          <Select.Option value={optName}>{displayName}</Select.Option>
        )}
      </Select>
    </Form.Item>
  </Form>
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
      <div className="mapping-editor-json-poiter-error">
        {error ? error : "\u00A0"}
      </div>
    </>
  );
}

function isValidJsonPointer(val) {
  return (
    val.length > 0 &&
    val[0] === "/" &&
    val[val.length - 1] !== "/" &&
    val.indexOf(" ") < 0
  );
}
