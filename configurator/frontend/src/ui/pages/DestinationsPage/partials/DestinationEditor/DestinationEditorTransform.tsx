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
import styles from "../../../SourcesPage/partials/SourceEditor/SourceEditor.module.less";

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
            <TabDescription>{DESTINATION_EDITOR_MAPPING}</TabDescription>
            <a onClick={() => setDocumentationVisible(true)}>
                Documentation
            </a>
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
                        defaultValue: '',
                        required: false,
                        jsDebugger: 'object',
                        type: jsType,
                        documentation: <>
                            A text description of the reason for running this job.
                            The value is treated as <a href={"https://jitsu.com/docs/configuration/javascript-functions"}>JavaScript functions</a>
                        </>
                    }]}
                    form={form}
                    initialValues={destinationData}
                />
            </Form>

                <Drawer
                    title={<h2>Transform documentation</h2>}
                    placement="right"
                    closable={true}
                    onClose={() => setDocumentationVisible(false)}
                    width="70%"
                    visible={documentationVisible}
                >
                    <div className={styles.documentation}>
                        <Collapse defaultActiveKey={['overview']} ghost>
                            <Collapse.Panel
                                header={
                                    <div className="uppercase font-bold">
                                        Overview
                                    </div>
                                }
                                key="overview"
                            ><p>
                                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam efficitur fringilla nisl, non efficitur metus. Proin volutpat aliquet turpis, a varius turpis rhoncus eget. Suspendisse augue leo, condimentum non nisl id, vestibulum porta turpis. Nunc pulvinar viverra est et fermentum. Fusce augue lectus, molestie ac augue sit amet, ultrices mollis libero. Vivamus eget dui vehicula, facilisis arcu in, porttitor arcu. Interdum et malesuada fames ac ante ipsum primis in faucibus. Etiam congue egestas turpis nec luctus. Praesent lectus ex, lobortis sit amet magna non, volutpat interdum lectus. Sed consequat at mauris vitae rhoncus. Nunc sit amet elementum risus, varius sodales lacus. Nunc consectetur porttitor facilisis. Nullam eget lorem ultrices, tincidunt libero ut, condimentum dui.
                            </p><p>
                                Vestibulum a ultricies tortor, quis porta sapien. Integer blandit, erat eu placerat ornare, lorem elit suscipit nunc, ornare hendrerit diam urna eu justo. Quisque at ligula dignissim eros consectetur posuere. Pellentesque sit amet facilisis mauris, at tempus dui. Nullam lacinia eleifend odio, ac condimentum massa pretium vel. Sed eu augue quis urna dapibus tristique. Donec nec eleifend est. Aliquam auctor mauris ut elit pretium, a sodales tortor efficitur. Quisque tincidunt, diam eu posuere ullamcorper, ipsum tellus sagittis enim, sit amet eleifend mauris neque vitae nisi. Etiam egestas mi vitae magna venenatis, sit amet mollis neque vehicula. Nullam id ipsum in elit laoreet tempor ac eget sem. Morbi blandit quam hendrerit enim tristique maximus nec eget turpis. Vivamus condimentum tellus tincidunt faucibus eleifend. Duis eu velit ullamcorper, fringilla nisi ut, consequat tortor.
                        </p>
                        </Collapse.Panel>
                        </Collapse>
                    </div>
                </Drawer>
        </>
    )
};

DestinationEditorTransform.displayName = 'DestinationEditorTransform';

export { DestinationEditorTransform };
