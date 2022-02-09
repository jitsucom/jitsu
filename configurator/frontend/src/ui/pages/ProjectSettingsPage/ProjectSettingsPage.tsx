/* eslint-disable */
import React, { useCallback, useState } from "react"
import { ProjectSettings, projectSettingsStore } from "../../../stores/projectSettings"
import { CenteredError, CenteredSpin } from "../../../lib/components/components"
import { actionNotification } from "../../components/ActionNotification/ActionNotification"
import { Prompt } from "react-router-dom"
import { FormActions, FormField, FormLayout, unsavedMessage } from "../../../lib/components/Form/Form"
import { Button, Form, Input } from "antd"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import useForm from "antd/lib/form/hooks/useForm"

export default function ProjectSettingsPage() {
  let { error, data, setData, isLoading: loading } = useLoaderAsObject(projectSettingsStore.get)
  let [pending, setPending] = useState<boolean>()
  let [form] = useForm<ProjectSettings>()
  form.setFieldsValue(data)

  let onSave = useCallback(async () => {
    if (!form.isFieldsTouched()) {
      return
    }

    setPending(true)
    try {
      setData(await projectSettingsStore.patch(form.getFieldsValue()))
    } catch (e) {
      actionNotification.error(`${e}`)
    } finally {
      setPending(false)
    }
  }, [])

  return (
    <>
      {loading && !data && <CenteredSpin />}
      {!!error && !data && <CenteredError error={error} />}
      {!error && !!data && (
        <div className="flex justify-center w-full">
          {form.isFieldsTouched() && <Prompt message={unsavedMessage} />}
          <div className="w-full pt-8 px-4" style={{ maxWidth: "1000px" }}>
            <Form form={form}>
              <FormLayout>
                <h2>Notifications</h2>
                <FormField
                  label="Slack"
                  tooltip="Slack webhook URL for sending task status updates"
                  key="notifications.slack.url"
                >
                  <Form.Item name="notifications.slack.url">
                    <Input size="large" name="notifications.slack.url" placeholder="Webhook URL" disabled={pending} />
                  </Form.Item>
                </FormField>
              </FormLayout>
              <FormActions>
                <Button onClick={onSave} loading={pending}>
                  Save
                </Button>
              </FormActions>
            </Form>
          </div>
        </div>
      )}
    </>
  )
}
