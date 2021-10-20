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
                <p>Use the power of Javascript to modify incoming event object, replace it with completely new event or produce multiple events based on incoming data.<br/>
                Also you can use Transform to set destination table name for each event or to completely skip event.</p>
                <p><a onClick={() => setDocumentationVisible(true)}>See examples</a> or read more about Transform in <a href="https://jitsu.com/docs/configuration/schema-and-mappings" target="_blank" rel="noreferrer">Documentation</a>.</p>
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
                                <p>You can use modern javascript language features and builtin functions to transform incoming event.<br/>
                                Jitsu puts incoming event as global variable: <code>$</code><br/></p><p>
                                Provided javascript need to return:
                                <ul>
                                    <li><b>single object</b> - modified incoming event or completely new object </li>
                                    <li><b>array of objects</b> - single incoming event will result in multiple events in destinations</li>
                                    <li><b>null</b> - to skip event from processing</li>
                                </ul>
                                </p>
                                <p>To override destination table you need to add special property to resulting events.
                                    This name stored in global variable: <code>TABLE_NAME</code>
                                </p>
                            </Collapse.Panel>
                            <Collapse.Panel header={<div className="font-bold">Modify incoming event</div>}
                                            key="modify">
                                <p>Jitsu spread operator allows to make copy of incoming event while applying some changes in just few lines of code:</p>
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
                            <Collapse.Panel header={<div className="font-bold">Building new event</div>}
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

                            </Collapse.Panel>
                        </Collapse>
                    </div>
                </Drawer>
        </>
    )
};

DestinationEditorTransform.displayName = 'DestinationEditorTransform';

export { DestinationEditorTransform };
