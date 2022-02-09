/* eslint-disable */
import React, {useCallback, useState} from "react"
import {ProjectSettings, projectSettingsStore} from "../../../stores/projectSettings";
import {Button, Form, Input} from "antd";
import useForm from "antd/lib/form/hooks/useForm";
import {Prompt} from "react-router-dom";
import {FormActions, FormField, FormLayout, unsavedMessage} from "../../../lib/components/Form/Form";
import {actionNotification} from "../../components/ActionNotification/ActionNotification";

type Props = {
  data: ProjectSettings
  loading: boolean
  setData: (ProjectSettings) => void
  setLoading: (boolean) => void
}

export const ProjectSettingsEditor: React.FC<Props> = (props => {
  let [form] = useForm<ProjectSettings>()
  form.setFieldsValue(props.data)

  let [loading, setLoading] = useState<boolean>()

  let onSave = useCallback(async () => {
    if (!form.isFieldsTouched()) {
      return
    }

    setLoading(true)
    try {
      props.setData(await projectSettingsStore.patch(form.getFieldsValue()))
    } catch (e) {
      props.setData(form.getFieldsValue())
      actionNotification.error(`${e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  return <div className="flex justify-center w-full">
    {form.isFieldsTouched() && <Prompt message={unsavedMessage}/>}
    <div className="w-full pt-8 px-4" style={{maxWidth: "1000px"}}>
      <Form form={form}>
        <FormLayout>
          <h2>Notifications</h2>
          <FormField label="Slack" tooltip="Slack webhook URL for sending task status updates"
                     key="notifications.slack.url">
            <Form.Item name="notifications.slack.url">
              <Input size="large" name="notifications.slack.url" placeholder="Webhook URL" disabled={loading}/>
            </Form.Item>
          </FormField>
        </FormLayout>
        <FormActions>
          <Button onClick={onSave} loading={loading}>Save</Button>
        </FormActions>
      </Form>
    </div>
  </div>
})