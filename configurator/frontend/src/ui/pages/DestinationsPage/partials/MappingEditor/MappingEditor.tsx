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
import { validatePassword } from "@./lib/commons/passwordValidator";
import classNames from "classnames";

export type MappingEditorProps = {
  mappings: FieldMappings
  onChange: (mappings: FieldMappings, isValid: boolean) => void
}

export type MappingWrapper = {
  mapping: Mapping
  modified: boolean
}

export function MappingEditor(props: MappingEditorProps) {
  const [keepUnmappedFields, setKeepUnmappedFields] = useState(props.mappings ? props.mappings.keepUnmappedFields : true);
  const [mappings, updateMappings] = useState(props.mappings ? props.mappings.mappings.map(mapping => ({ mapping, modified: false })) : []);
  const bottomScrollRef = useRef<HTMLDivElement>(null);

  let onChange = () => {
    props.onChange(new FieldMappings(mappings.map(m => m.mapping), keepUnmappedFields), false)
  }

  let addFieldMapping = () => {
    mappings.push({ mapping: new Mapping("", "", null), modified: true })
    updateMappings(mappings);
    onChange();
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
          defaultValue={keepUnmappedFields ? "keep" : "remove"}
          onChange={(value) => {
            setKeepUnmappedFields(value === "keep");
            onChange();
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
          {mappings?.length > 0 ?
            (mappings.map(((mw, index) => <MappingLine mapping={mw.mapping} lineNumber={index + 1} modified={mw.modified}/>))) :
            <div className="text-center text-sm p-12 text-secondaryText italic">
              <p>Mappings list is empty! Please, add fields by clicking 'Add Field Mapping' button below.</p>
              <p>Mappings defines how the data will be transformed before it landed to destination. The result of
                transformation is an another.
                Read more about <a href="https://jitsu.com/docs/configuration/schema-and-mappings">mappings in documentation</a>.</p>
            </div>
          }
        </div>
        <div key="scroll" className="text-right py-4">
          {mappings?.length > 6 &&
          <Button className="mr-2 text-xs" type="primary" size="small" icon={<PlusOutlined/>} onClick={addFieldMapping}>Add Field Mapping</Button>}
        </div>
        <div key="scroll-ref" ref={bottomScrollRef}/>

      </div>
    </div>
  </div>
}

const MappingLine = React.memo(({ mapping, lineNumber, modified }: { mapping: Mapping, lineNumber: number, modified: boolean }) => {
  let dstVisible = mapping.action !== "erase";
  return <div className="py-2 flex border-b items items-center">
    <div className="mr-2.5 w-6 text-right whitespace-nowrap">{lineNumber} {modified && <sup>*</sup>}.</div>
    <JsonFieldEditor value={mapping.srcField} onChange={(val) => {
    }}/>

    {dstVisible && <>
      <div>→</div>
      <JsonFieldEditor value={mapping.srcField} onChange={(val) => {

      }}/>
      <Select size="small">
        {Object.entries(MAPPING_NAMES).map(([optName, displayName]) =>
          <Select.Option value={optName}>{displayName}</Select.Option>
        )}
      </Select>
    </>}

    <div className="text-right flex-grow">
      <Button icon={<DeleteOutlined/>}/>
    </div>
  </div>
});

const JsonFieldEditor = ({ value, onChange, className, ...rest }: { value: string, onChange: (string, valid) => void, className?: string }) => {
  const [valid, setValid] = useState(true)
  const [currentValue, setValue] = useState(value)
  return <div>
    <Input className={classNames(styles.jsonPointer, className)} name="dst" type="text" size="small"
           placeholder="/path/to/node"
           onChange={(e) => {
             let value = e.target.value;
             let valid = isValidJsonPointer(value);
             setValid(valid);
             setValue(value);
             onChange(value, valid);
           }} value={currentValue} {...rest}/>
    {!(valid || value.length === 0) && <div className="text-xxs block text-error">Json pointer is not valid!</div>}
  </div>
}

function isValidJsonPointer(val) {
  return val.length > 0 && val[0] === "/" && val[val.length - 1] !== "/" && val.indexOf(" ") < 0;
}

function jsonValidator(rule, val, callback) {
  if (isValidJsonPointer(val)) {
    callback()
  } else {
    callback("Field should be a valid json node pointer (as /node/subnode/...)")
  }
}
