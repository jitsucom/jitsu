// @Libs
import React from "react"
import { Form } from "antd"
import debounce from "lodash/debounce"
// @Components
import { ConfigurableFieldsForm } from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
// @Types
import { Destination } from "@jitsu/catalog"
import { FormInstance } from "antd/lib/form/hooks/useForm"
import useProject from "../../../../../hooks/useProject"
import { allPermissions } from "../../../../../lib/services/permissions"
import { ProjectPermission } from "../../../../../generated/conf-openapi"

export interface Props {
  destinationData: DestinationData
  destinationReference: Destination
  form: FormInstance
  handleTouchAnyField: (...args: any) => void
}

const DestinationEditorConfig = ({ destinationData, destinationReference, form, handleTouchAnyField }: Props) => {
  const handleChange = debounce(handleTouchAnyField, 500)
  const project = useProject();
  const disableEdit = !(project.permissions || allPermissions).includes(ProjectPermission.MODIFY_CONFIG);
  return (
    <>
      <Form disabled={disableEdit} name="destination-config" form={form} autoComplete="off" onChange={handleChange}>
        <ConfigurableFieldsForm
          handleTouchAnyField={handleTouchAnyField}
          fieldsParamsList={destinationReference.parameters}
          form={form}
          initialValues={destinationData}
        />
      </Form>
    </>
  )
}

DestinationEditorConfig.displayName = "DestinationEditorConfig"

export { DestinationEditorConfig }
