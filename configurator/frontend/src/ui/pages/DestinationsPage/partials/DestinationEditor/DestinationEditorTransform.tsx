// @Libs
import React, {useState} from 'react';
import {Collapse, Drawer, Form} from 'antd';
import debounce from 'lodash/debounce';
// @Components
import { ConfigurableFieldsForm } from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm';
// @Types
import { Destination } from 'catalog/destinations/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import {booleanType, jsType, stringType} from "../../../../../catalog/sources/types";
import {TabDescription} from "../../../../components/Tabs/TabDescription";
import styles from "./DestinationEditor.module.less";
import {destinationsReferenceMap} from "../../../../../catalog/destinations/lib";
import {CodeSnippet} from "../../../../../lib/components/components";
import {camelCase} from "lodash";

export interface Props {
    destinationData: DestinationData;
    destinationReference: Destination;
    form: FormInstance;
    handleTouchAnyField: (...args: any) => void;
}

const DestinationEditorTransform = ({ destinationData, destinationReference, form, handleTouchAnyField }: Props) => {
    const handleChange = debounce(handleTouchAnyField, 500);
    const [documentationVisible, setDocumentationVisible] = useState(false);

    return (
        <>
            <TabDescription>
                <p>Use the power of Javascript to modify incoming event object, replace it with a completely new event or produce multiple events based on incoming data.<br/>
                    Also, you can use <b>Transform</b> to assign Data Warehouse specific SQL types for object fields, set the destination table name for each event or to skip the event altogether. <a onClick={() => setDocumentationVisible(true)}>Open Documentation →</a><br/>
                        <b>Transform</b> effectively replaces <b>Mappings</b> – both features cannot work together.
                </p>
            </TabDescription>
            <Form
                name="destination-config"
                form={form}
                autoComplete="off"
                onChange={handleChange}
            >
                <ConfigurableFieldsForm
                    handleTouchAnyField={handleTouchAnyField}
                    fieldsParamsList={[{
                        id: '_transform_enabled',
                        displayName: 'Enable Javascript Transformation',
                        defaultValue: !!destinationsReferenceMap[destinationData._type].defaultTransform && !destinationData._mappings?._mappings,
                        required: false,
                        type: booleanType,
                        bigField: true
                    },
                        {
                        id: '_transform',
                        codeSuggestions: `declare const destinationId = "${destinationData._uid}";
declare const destinationType = "${destinationData._type}";
${[destinationData._type, "segment"].map(type => `declare function ${camelCase('to_' + type)}(event: object): object`).join('\n')}`,
                        displayName: 'Javascript Transformation',
                        defaultValue: destinationsReferenceMap[destinationData._type].defaultTransform || 'return $',
                        required: false,
                        jsDebugger: 'object',
                        type: jsType,
                        bigField: true,
                    }]}
                    form={form}
                    initialValues={destinationData}
                />
            </Form>

                <Drawer
                    title={<h2>Transform Examples</h2>}
                    placement="right"
                    closable={true}
                    onClose={() => setDocumentationVisible(false)}
                    width="50%"
                    visible={documentationVisible}
                >
                    <div className={styles.documentation}>
                        <Collapse defaultActiveKey={['overview']} ghost>
                            <Collapse.Panel header={<div className="font-bold">Overview</div>}
                                key="overview">
                                <p>You can use modern javascript language features and built-in functions to transform an incoming event.<br/>
                                    Jitsu puts incoming event as a global variable: <code>$</code><br/></p><p>
                                Provided javascript must return:
                                <ul>
                                    <li><b>single object</b> - modified incoming event or completely new object </li>
                                    <li><b>array of objects</b> - a single incoming event will result in multiple events in destinations</li>
                                    <li><b>null</b> - to skip event from processing</li>
                                </ul>
                                </p>
                                <p>To override the destination table, you need to add a special property <code>JITSU_TABLE_NAME</code> to the resulting events.
                                </p>
                                <p>To override the destination SQL column type for a specific object field, you need to add an extra property with the special prefix <code>__sql_type_</code> added to the name of a field to resulting events.
                                    E.g.: <code>__sql_type_utc_time: "date"</code> sets SQL type <b>date</b> for column <b>utc_time</b>
                                </p>
                                <p>See more bellow.</p>
                            </Collapse.Panel>
                            <Collapse.Panel header={<div className="font-bold">Modify incoming event</div>}
                                            key="modify">
                                <p>Javascript spread operator allows making a copy of an incoming event while applying some changes in just a few lines of code:</p>
                                    <CodeSnippet size={"large"} language={"javascript"}>{
`return {...$,
    new_property: $.event_type
}`
                                    }</CodeSnippet>
                                <p>Add property to user object:</p>
                                    <CodeSnippet size={"large"} language={"javascript"}>{
`return {...$, 
        user: {...$.user, state: "active"}
        }`
                                    }</CodeSnippet>
                            </Collapse.Panel>
                            <Collapse.Panel header={<div className="font-bold">Build new event</div>}
                                            key="new">
                                <p>Collect some user properties to the new object:</p>
                                    <CodeSnippet size={"large"} language={"javascript"}>{
`return {
  properties: [
    {
      property: "email",
      value: $.user?.email
    },
    {
      property: "language",
      value: $.user_language
    }
  ]
}`
                                    }</CodeSnippet>

                                <p>Put an original event as a string payload:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
`return {
        "event_type": "POST event",
        "payload": JSON.stringify($)
}`
                                }</CodeSnippet>

                            </Collapse.Panel>
                            <Collapse.Panel header={<div className="font-bold">Produce multiple events</div>}
                                            key="multiple">
                                <p>Produce multiple purchase events from a single shopping cart event:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
`if ($.event_type == "conversion" && $.products?.length > 0) {
        let results = []
        for (const product of $.products) {
                results.push({
                        event_type: "purchase",
                        product_id: product.id,
                        price: product.price
                })
        }
        return results
} else {
        //skip events without any purchase
        return null
}`
                                }</CodeSnippet>

                            </Collapse.Panel>
                            <Collapse.Panel header={<div className="font-bold">Override destination table</div>}
                                            key="tablename">
                                <p>Using Javascript spread operator:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
                                    `return {...$, JITSU_TABLE_NAME: "new_table_name"}`
                                }</CodeSnippet>
                                <p><code>TABLE_NAME</code> is not a property name. It is a global variable pointing to an actual property name.</p>
                                <p>Conventional way:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
`$.JITSU_TABLE_NAME = "new_table_name"
return $`
                                }</CodeSnippet>
                            </Collapse.Panel>
                            <Collapse.Panel header={<div className="font-bold">Override SQL column type</div>}
                                            key="sql_type">
                                <p>Set simple SQL types:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
`return {...$, 
    event_date: $.utc_time,                               
    __sql_type_event_date: "date",
    event_time: $.utc_time,
    __sql_type_event_time: "time"
}`
                                }</CodeSnippet>
                                <p>Sql types with extra parameters:<br/>
                                Some Data Warehouses support extra parameters for column types during table creation.<br/>
                                For such cases, Transform uses the following syntax to provide data type and column type separately:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
                                    `return {...$, 
    title: $.page_title,                               
    __sql_type_title: ["varchar(256)", "varchar(256) encode zstd"]
}`
                                }</CodeSnippet>
                            </Collapse.Panel>
                        </Collapse>
                    </div>
                </Drawer>
        </>
    )
};

DestinationEditorTransform.displayName = 'DestinationEditorTransform';

export { DestinationEditorTransform };
