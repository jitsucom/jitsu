// @Libs
import React, {useState} from 'react';
import {Collapse, Drawer, Form} from 'antd';
import debounce from 'lodash/debounce';
// @Components
import { ConfigurableFieldsForm } from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm';
// @Types
import { Destination } from 'catalog/destinations/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import {jsType, stringType} from "../../../../../catalog/sources/types";
import {TabDescription} from "../../../../components/Tabs/TabDescription";
import {DESTINATION_EDITOR_MAPPING} from "../../../../../embeddedDocs/mappings";
import styles from "./DestinationEditor.module.less";
import {destinationsReferenceMap} from "../../../../../catalog/destinations/lib";
import {CodeSnippet} from "../../../../../lib/components/components";

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
            <TabDescription><>
                <p>Use the power of Javascript to modify incoming event object, replace it with a completely new event or produce multiple events based on incoming data.<br/>
                    Also, you can use Transform to set the destination table name for each event or to skip the event altogether.</p>
                <p><a onClick={() => setDocumentationVisible(true)}>Documentation</a></p>
            </></TabDescription>
            <Form
                name="destination-config"
                form={form}
                autoComplete="off"
                onChange={handleChange}
            >
                <ConfigurableFieldsForm
                    handleTouchAnyField={handleTouchAnyField}
                    fieldsParamsList={[{
                        id: '_transform',
                        displayName: 'Javascript Transformation',
                        defaultValue: destinationsReferenceMap[destinationData._type].defaultTransform,
                        required: false,
                        jsDebugger: 'object',
                        type: jsType,
                        bigField: true,
                        // documentation: <>
                        //     A text description of the reason for running this job.
                        //     The value is treated as <a href={"https://jitsu.com/docs/configuration/javascript-functions"}>JavaScript functions</a>
                        // </>
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
                    width="40%"
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
                                <p>To override the destination table, you need to add a special property to the resulting events.
                                    This property name is stored in the global variable: <code>TABLE_NAME</code>
                                </p>
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
                                    `return {...$, [TABLE_NAME]: "new_table_name"}`
                                }</CodeSnippet>
                                <p><code>TABLE_NAME</code> is not a property name. It is a global variable pointing to an actual property name.</p>
                                <p>Conventional way:</p>
                                <CodeSnippet size={"large"} language={"javascript"}>{
`$[TABLE_NAME] = "new_table_name"
return $`
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
