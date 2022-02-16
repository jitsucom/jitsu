import { Button, Form, Input } from "antd"
import { observer } from "mobx-react-lite"
import { apiKeysStore } from "../../../stores/apiKeys"
import { Prompt, useHistory, useParams } from "react-router-dom"
import { CenteredError } from "../components"
import { useForm } from "antd/es/form/Form"
import ReloadOutlined from "@ant-design/icons/lib/icons/ReloadOutlined"
import React, { ReactNode, useState } from "react"
import { FormField, FormLayout, FormActions, unsavedMessage } from "../Form/Form"
import TextArea from "antd/es/input/TextArea"
import { BreadcrumbsProps } from "../../../ui/components/Breadcrumbs/Breadcrumbs"
import { confirmDelete } from "../../commons/deletionConfirmation"
import { flowResult } from "mobx"
import { useServices } from "../../../hooks/useServices"
import { NavLink } from "react-router-dom"
import { destinationsStore } from "../../../stores/destinations"
import { DestinationPicker } from "./DestinationPicker"
import union from "lodash/union"

export const apiKeysRoutes = {
  newExact: "/api-keys/new",
  listExact: "/api-keys",
  editExact: "/api-keys/:id",
} as const

type ApiKeyEditorProps = {
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void
}

function newKey(): ApiKey {
  let uid = apiKeysStore.generateApiToken("", 6)
  return {
    uid: uid,
    serverAuth: apiKeysStore.generateApiToken("s2s"),
    jsAuth: apiKeysStore.generateApiToken("js"),
    comment: "New API Key",
    origins: [],
  }
}

const SecretKey: React.FC<{
  formFieldName: string
  formFieldLabel: string
  children: ReactNode
  onGenerate: () => void
}> = ({
  //children is tooltip
  children,
  onGenerate,
  formFieldName,
  formFieldLabel,
}) => {
  return (
    <FormField label={formFieldLabel} tooltip={children}>
      <div className="flex flex-nowrap space-x-1 items-center">
        <Form.Item name={formFieldName} className="w-full" rules={[{ required: true }]}>
          <Input
            required={true}
            size="large"
            suffix={<Button type="text" icon={<ReloadOutlined />} onClick={onGenerate} />}
          />
        </Form.Item>
      </div>
    </FormField>
  )
}

type EditorObject = Omit<ApiKey, "origins"> & { originsText?: string; connectedDestinations?: string }

function getEditorObject({ origins, ...rest }: ApiKey) {
  return {
    ...rest,
    comment: rest.comment || rest.uid,
    originsText: origins ? origins.join("\n") : "",
  }
}

function getKey({ originsText, connectedDestinations, ...rest }: EditorObject, initialValue: ApiKey) {
  return {
    ...initialValue,
    ...rest,
    origins: originsText && originsText.trim() !== "" ? originsText.split("\n").map(line => line.trim()) : [],
  }
}

const ApiKeyEditorComponent: React.FC<ApiKeyEditorProps> = props => {
  let { id = undefined } = useParams<{ id?: string }>()
  if (id) {
    id = id.replace("-", ".")
  }
  const initialApiKey = id ? apiKeysStore.get(id) : newKey()
  if (!initialApiKey) {
    return <CenteredError error={new Error(`Key with id ${id} not found`)} />
  }
  const [editorObject, setEditorObject] = useState<EditorObject>(getEditorObject(initialApiKey))
  const history = useHistory()
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = useForm<any>()

  form.setFieldsValue(editorObject)
  return (
    <div className="flex justify-center w-full">
      {form.isFieldsTouched() && !saving && !deleting && <Prompt message={unsavedMessage} />}
      <div className="w-full pt-8 px-4" style={{ maxWidth: "1000px" }}>
        <Form form={form}>
          <FormLayout>
            <span
              style={
                deleting || saving
                  ? {
                      opacity: "0.5",
                      pointerEvents: "none",
                    }
                  : {}
              }
            >
              <FormField label="Key Name" tooltip="Name of the key" key="comment">
                <Form.Item name="comment">
                  <Input size="large" name="comment" placeholder="Key Name" required={true} />
                </Form.Item>
              </FormField>
              <SecretKey
                onGenerate={() => {
                  setEditorObject({
                    ...editorObject,
                    jsAuth: apiKeysStore.generateApiToken("js"),
                  })
                }}
                formFieldName="jsAuth"
                formFieldLabel="Client-side (JS) key"
              >
                The key that is used for client-side Jitsu libraries (JavaScript, iOS etc). You can consider this key as
                'public' since it is visible to any end-user
              </SecretKey>
              <SecretKey
                onGenerate={() => {
                  setEditorObject({
                    ...editorObject,
                    serverAuth: apiKeysStore.generateApiToken("s2s"),
                  })
                }}
                formFieldName="serverAuth"
                formFieldLabel="Server-side key"
              >
                The key that is user for sending data from backend libraries (python, s2s API etc). Do not publish this
                key
              </SecretKey>
              <FormField
                label="HTTP Origins"
                tooltip={
                  <>
                    If set, only traffic from listed domains will be accepted. Blocking is done via{" "}
                    <a href="https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS">CORS headers</a>. Leave empty for
                    accept traffic from any domain. Wildcard syntax (<code>*.domain.com</code>) is accepted. Put each
                    domain on a new line
                  </>
                }
                key="js"
              >
                <Form.Item name="originsText">
                  <TextArea required={false} size="large" rows={10} name="originsText" />
                </Form.Item>
              </FormField>
              <FormField
                label="Connected Destinations"
                tooltip={
                  <>
                    <NavLink to="/destinations">Destinations</NavLink> that are connected to this particular key
                  </>
                }
                key="connectedDestinations"
              >
                <Form.Item name="connectedDestinations">
                  <DestinationPicker
                    allDestinations={destinationsStore.list}
                    isSelected={dst => dst._onlyKeys.includes(id)}
                  />
                </Form.Item>
              </FormField>
            </span>
            <FormActions>
              {id && (
                <Button
                  loading={deleting}
                  htmlType="submit"
                  size="large"
                  type="default"
                  danger
                  onClick={() => {
                    confirmDelete({
                      entityName: "api key",
                      action: async () => {
                        setDeleting(true)
                        try {
                          await flowResult(apiKeysStore.delete(id))
                          await history.push(apiKeysRoutes.listExact)
                        } finally {
                          setDeleting(false)
                        }
                      },
                    })
                  }}
                >
                  Delete
                </Button>
              )}
              <Button
                htmlType="submit"
                size="large"
                type="default"
                onClick={() => {
                  if (form.isFieldsTouched()) {
                    if (confirm(unsavedMessage)) {
                      history.push(apiKeysRoutes.listExact)
                    }
                  } else {
                    history.push(apiKeysRoutes.listExact)
                  }
                }}
              >
                Cancel
              </Button>
              <Button
                loading={saving}
                htmlType="submit"
                size="large"
                type="primary"
                onClick={async () => {
                  try {
                    setSaving(true)
                    const connectedDestinations: string[] = form.getFieldsValue().connectedDestinations || []
                    const key = getKey(form.getFieldsValue(), initialApiKey)
                    if (id) {
                      await flowResult(apiKeysStore.replace({ ...key, uid: id }))
                    } else {
                      await flowResult(apiKeysStore.add(key))
                    }
                    await flowResult(destinationsStore.updateDestinationsLinksToKey(key.uid, connectedDestinations))
                    history.push(apiKeysRoutes.listExact)
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                Save
              </Button>
            </FormActions>
          </FormLayout>
        </Form>
      </div>
    </div>
  )
}

export const ApiKeyEditor = observer(ApiKeyEditorComponent)
