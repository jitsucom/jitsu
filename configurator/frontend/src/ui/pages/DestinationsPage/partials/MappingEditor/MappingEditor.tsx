/* eslint-disable */
import * as React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import styles from "./MappingEditor.module.less";
import PlayCircleFilled from "@ant-design/icons/lib/icons/PlayCircleFilled"
import DeleteFilled from "@ant-design/icons/lib/icons/DeleteFilled";
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined";
import ApplicationServices from "@./lib/services/ApplicationServices";
import { loadDestinations } from "@page/DestinationsPage/commons";
import { useParams, NavLink } from "react-router-dom";
import { DestinationConfig } from "@./lib/services/destinations";
import Marshal from "@./lib/commons/marshalling";
import { FloatingLabelInput } from "@molecule/FloatingLabelInput";
import { DeleteOutlined } from "@ant-design/icons";

export type MappingEditorProps = {
  mappings: FieldMappings
  onChange: (mappings: FieldMappings, isValid: boolean) => void
}

export function MappingEditor(props: MappingEditorProps) {
  const [mappings, updateMappings] = useState(props.mappings || new FieldMappings([], false));
  console.log("Editing mappings", props);
  const bottomScrollRef = useRef<HTMLDivElement>(null);

  let addFieldMapping = () => {
    mappings.addMapping(new Mapping("", "", null))
    updateMappings(mappings);
    props.onChange(mappings, false);
    if (bottomScrollRef.current) {
      bottomScrollRef.current.scrollIntoView({
        block: "end",
        behavior: "smooth"
      });
    }
  };
  return <div className="px-auto">
    <div className="rounded mt-1">
      <div className="flex rounded-t items-center py-3 border-b">
        <LabelWithTooltip className="flex-shrink pr-4" documentation={<>
          Depending on this setting, mapping engine will either keep a field intact if it's not explicitly
          mapped to other field, or remove it <a href="https://jitsu.com/docs/configuration/schema-and-mappings">Read
          more about mappings</a>
        </>}>Unmapped field strategy: </LabelWithTooltip>
        <Select
          className="w-48" size="small"
          defaultValue={mappings.keepUnmappedFields ? "keep" : "remove"}
          onChange={(value) => {
            mappings.keepUnmappedFields = value === "keep";
            updateMappings(mappings);
          }}
        >
          <Select.Option value="keep">Keep fields</Select.Option>
          <Select.Option value="remove">Remove fields</Select.Option>
        </Select>
        <div className="flex-grow flex justify-end">
          <Button className="mr-2 text-xs" type="primary" size="small" icon={<PlusOutlined/>} onClick={addFieldMapping}>Add Field Mapping</Button>
          <Button className="text-xs" size="small" icon={<PlayCircleFilled/>}>Test Mapping</Button>
        </div>
      </div>
      <div>
        <div key="mappings">
          {mappings.mappings?.length > 0 ?
            (mappings.mappings.map(((mapping, index) => <MappingLine mapping={mapping} lineNumber={index + 1}/>))) :
            <div className="text-center text-sm p-12 text-secondaryText italic">
              <p>Mappings list is empty! Please, add fields by clicking 'Add Field Mapping' button below.</p>
              <p>Mappings defines how the data will be transformed before it landed to destination. The result of
                transformation is an another.
                Read more about <a href="https://jitsu.com/docs/configuration/schema-and-mappings">mappings in documentation</a>.</p>
            </div>
          }
        </div>
        <div key="scroll" className="text-right py-4">
          {mappings.mappings?.length > 6 &&
            <Button className="mr-2 text-xs" type="primary" size="small" icon={<PlusOutlined/>} onClick={addFieldMapping}>Add Field Mapping</Button>}
        </div>
        <div key="scroll-ref" ref={bottomScrollRef} />

      </div>
    </div>
  </div>
}

const MappingLine = React.memo(({ mapping, lineNumber }: { mapping: Mapping, lineNumber: number }) => {
  const [form] = Form.useForm();
  let key = mapping['__rowKey'];
  return <Form key={key} layout="inline" className="py-2 flex border-b items items-center"
               form={form}
               initialValues={{
                 src: mapping.srcField,
                 dst: mapping.dstField,
                 type: mapping.action
               }}
  >
    <div className={"mr-2.5 w-6 text-right"}>{lineNumber}.</div>
    <Form.Item name="src">
      <Input className={styles.jsonPointer} type="text" size="small" placeholder="/src/field/path"/>
    </Form.Item>

    <div>→</div>
    <Form.Item name="dst">
      <Input className={styles.jsonPointer} name="dst" type="text" size="small" placeholder="/destination/field/path"/>
    </Form.Item>
    <Form.Item name="type" className="text-xs w-48">
      <Select size="small">
        {Object.entries(MAPPING_NAMES).map(([optName, displayName]) =>
          <Select.Option value={optName}>{displayName}</Select.Option>
        )}
      </Select>
    </Form.Item>
    <div className="text-right flex-grow">
      <Button icon={<DeleteOutlined/>}/>
    </div>
  </Form>
});

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
