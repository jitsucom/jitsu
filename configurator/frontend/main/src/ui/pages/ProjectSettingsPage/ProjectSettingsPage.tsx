/* eslint-disable */
import React, { useEffect, useState } from "react"
import { loadProjectSettings, ProjectSettings, saveProjectSettings } from "../../../utils/projectSettings"
import { CenteredError, CenteredSpin } from "../../../lib/components/components"
import { actionNotification } from "../../components/ActionNotification/ActionNotification"
import { Prompt } from "react-router-dom"
import { FormActions, FormField, FormLayout, unsavedMessage } from "../../../lib/components/Form/Form"
import { Button, Form, Input } from "antd"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import useForm from "antd/lib/form/hooks/useForm"
import { flatten, unflatten } from "lib/commons/utils"
import { ApiOutlined } from "@ant-design/icons"

export default function ProjectSettingsPage() {
  let { error, data, setData, isLoading: loading } = useLoaderAsObject(loadProjectSettings)
  let [pending, setPending] = useState<boolean>()
  let [form] = useForm<ProjectSettings>()
  useEffect(() => {
    form.setFieldsValue(flatten(data))
  }, [data])

  let onSave = async () => {
    if (!form.isFieldsTouched()) {
      return
    }

    setPending(true)
    try {
      setData(await saveProjectSettings(unflatten(form.getFieldsValue())))
    } catch (e) {
      actionNotification.error(`${e}`)
    } finally {
      setPending(false)
    }
  }

  let onSlackTest = async () => {
    let url = unflatten<ProjectSettings>(form.getFieldsValue()).notifications?.slack?.url
    try {
      let response = await fetch(url, {
        method: "POST",
        body: `{"text": "Jitsu test notification"}`,
      })

      if (!response.ok) {
        throw new Error(response.statusText)
      }

      actionNotification.success("Slack test notification OK")
    } catch (e) {
      actionNotification.error(`Failed to send Slack test notification: ${e.message}`)
      console.log(e)
    }
  }

  return (
    <>
      {loading && !data && <CenteredSpin />}
      {!!error && !data && <CenteredError error={error} />}
      {!error && !!data && (
        <div className="flex justify-center w-full">
          {/*TODO see https://github.com/ant-design/ant-design/issues/33991*/}
          {/*{form.isFieldsTouched() && <Prompt message={unsavedMessage}/>}*/}
          <div className="w-full pt-8 px-4" style={{ maxWidth: "1000px" }}>
            <Form form={form} onFinish={onSave}>
              <FormLayout>
                <div className="border-2 rounded-md border-white p-8">
                  <h2>Notifications</h2>
                  <FormField
                    label="Slack"
                    tooltip="Slack webhook URL for sending task status updates"
                    key="notifications.slack.url"
                  >
                    <Form.Item name="notifications.slack.url">
                      <Input
                        size="small"
                        name="notifications.slack.url"
                        placeholder="Webhook URL"
                        disabled={pending}
                        suffix={<Button type="text" icon={<ApiOutlined />} onClick={onSlackTest} />}
                      />
                    </Form.Item>
                  </FormField>
                </div>
              </FormLayout>
              <FormActions>
                <div className="pt-8 text-right w-full">
                  <Button type="primary" size="large" htmlType="submit" loading={pending}>
                    Save
                  </Button>
                </div>
              </FormActions>
            </Form>
          </div>
        </div>
      )}
    </>
  )
}
