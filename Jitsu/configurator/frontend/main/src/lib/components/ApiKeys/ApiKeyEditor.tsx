import { Button, Form, Input, InputNumber } from "antd"
import { observer } from "mobx-react-lite"
import { apiKeysStore } from "../../../stores/apiKeys"
import { Prompt, useHistory, useParams } from "react-router-dom"
import { useForm } from "antd/es/form/Form"
import ReloadOutlined from "@ant-design/icons/lib/icons/ReloadOutlined"
import React, { ReactNode, useEffect, useState } from "react"
import { FormField, FormLayout, FormActions, unsavedMessage } from "../Form/Form"
import TextArea from "antd/es/input/TextArea"
import { confirmDelete } from "../../commons/deletionConfirmation"
import { flowResult } from "mobx"
import { NavLink } from "react-router-dom"
import { destinationsStore } from "../../../stores/destinations"
import { DestinationPicker } from "./DestinationPicker"
import { connectionsHelper } from "stores/helpers"
import { apiKeysRoutes } from "./ApiKeysRouter"
import { projectRoute } from "../ProjectLink/ProjectLink"
import { EntityNotFound } from "ui/components/EntityNotFound/EntityNotFound"
import { apiKeysReferenceMap } from "@jitsu/catalog"
import { PageHeader } from "../../../ui/components/PageHeader/PageHeader"
import { currentPageHeaderStore } from "../../../stores/currentPageHeader"
import { handleError } from "../components"
import useProject from "../../../hooks/useProject"
import { allPermissions } from "../../services/permissions"
import { ProjectPermission } from "../../../generated/conf-openapi"
import { useServices } from "../../../hooks/useServices"

const SecretKey: React.FC<{
  disabled?: boolean
  formFieldName: string
  formFieldLabel: string
  children: ReactNode
  onGenerate: () => void
}> = ({
  //children is tooltip
  disabled,
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
            disabled={!!disabled}
            required={true}
            size="large"
            suffix={<Button type="text" icon={<ReloadOutlined />} onClick={onGenerate} />}
          />
        </Form.Item>
      </div>
    </FormField>
  )
}

type EditorObject = Omit<ApiKey, "origins"> & { originsText?: string; connectedDestinations?: string[] }

function getEditorObject({ origins, ...rest }: ApiKey) {
  return {
    ...rest,
    comment: rest.comment || rest.uid,
    originsText: origins ? origins.join("\n") : "",
    connectedDestinations: destinationsStore.list.filter(d => d._onlyKeys.includes(rest.uid)).map(d => d._uid),
  }
}

function getKey({ originsText, connectedDestinations, ...rest }: EditorObject, initialValue: ApiKey) {
  return {
    ...initialValue,
    ...rest,
    origins: originsText && originsText.trim() !== "" ? originsText.split("\n").map(line => line.trim()) : [],
  }
}

const ApiKeyEditorComponent: React.FC = props => {
  const services = useServices()

  let { id = undefined } = useParams<{ id?: string }>()
  if (id) {
    id = id.replace("-", ".")
  }
  const isJitsuCloud: boolean = services.features.environment === "jitsu_cloud"

  const initialApiKey = id ? apiKeysStore.get(id) : apiKeysStore.generateApiKey()
  const [editorObject, setEditorObject] = useState<EditorObject>(initialApiKey ? getEditorObject(initialApiKey) : null)

  useEffect(() => {
    if (!initialApiKey) {
      return
    }

    let breadcrumbs = []
    breadcrumbs.push({
      title: "Api Keys",
      link: projectRoute(apiKeysRoutes.listExact),
    })
    breadcrumbs.push({
      title: (
        <PageHeader
          title={id ? initialApiKey.comment ?? "Not Found" : "New key"}
          icon={apiKeysReferenceMap.js.icon}
          mode={id ? "edit" : "add"}
        />
      ),
    })
    setTimeout(() => {
      currentPageHeaderStore.setBreadcrumbs(...breadcrumbs)
    }, 100)
  }, [initialApiKey])

  if (!initialApiKey) {
    return <EntityNotFound entityDisplayType="API Key" entityId={id} entitiesListRoute={apiKeysRoutes.listExact} />
  }
  const project = useProject()
  const disableEdit = !(project.permissions || allPermissions).includes(ProjectPermission.MODIFY_CONFIG)

  const history = useHistory()
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = useForm<any>()

  form.setFieldsValue(editorObject)
  return (
    <div className="flex justify-center w-full">
      {!disableEdit && form.isFieldsTouched() && !saving && !deleting && <Prompt message={unsavedMessage} />}
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
                  <Input size="large" disabled={disableEdit} name="comment" placeholder="Key Name" required={true} />
                </Form.Item>
              </FormField>
              <SecretKey
                disabled={disableEdit}
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
                disabled={disableEdit}
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
                    <a target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS">
                      CORS headers
                    </a>
                    . Leave empty for accept traffic from any domain. Wildcard syntax (<code>*.domain.com</code>) is
                    accepted. Put each domain on a new line
                  </>
                }
                key="js"
              >
                <Form.Item name="originsText">
                  <TextArea disabled={disableEdit} required={false} size="large" rows={10} name="originsText" />
                </Form.Item>
              </FormField>
              <FormField
                label="Batch Upload Period (minutes)"
                tooltip={
                  "Rotation period of collected incoming events log files and upload period of collected log files to destinations. When omitted default server value is used." +
                  (isJitsuCloud ? " For Jitsu Cloud default values is 5min." : "")
                }
                key="batchPeriodMin"
              >
                <Form.Item name="batchPeriodMin">
                  <InputNumber
                    size="large"
                    disabled={disableEdit}
                    placeholder={isJitsuCloud ? "5" : undefined}
                    autoComplete="off"
                    inputMode="numeric"
                    name="batchPeriodMin"
                  />
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
                    disabled={disableEdit}
                    allDestinations={destinationsStore.list}
                    isSelected={dst => dst._onlyKeys.includes(id)}
                  />
                </Form.Item>
              </FormField>
            </span>
            <FormActions>
              {id && !disableEdit && (
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
                          await history.push(projectRoute(apiKeysRoutes.listExact))
                        } catch (e) {
                          handleError(e, "Delete failed")
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
                  if (!disableEdit && form.isFieldsTouched()) {
                    if (confirm(unsavedMessage)) {
                      history.push(projectRoute(apiKeysRoutes.listExact))
                    }
                  } else {
                    history.push(projectRoute(apiKeysRoutes.listExact))
                  }
                }}
              >
                {disableEdit ? "Close" : "Cancel"}
              </Button>
              {!disableEdit && (
                <Button
                  loading={saving}
                  htmlType="submit"
                  size="large"
                  type="primary"
                  onClick={async () => {
                    try {
                      setSaving(true)
                      const connectedDestinations: string[] = form.getFieldsValue().connectedDestinations || []
                      let savedKey: ApiKey = getKey(form.getFieldsValue(), initialApiKey)
                      if (id) {
                        await flowResult(apiKeysStore.replace({ ...savedKey, uid: id }))
                      } else {
                        savedKey = await flowResult(apiKeysStore.add(savedKey))
                      }
                      await connectionsHelper.updateDestinationsConnectionsToApiKey(savedKey.uid, connectedDestinations)
                      history.push(projectRoute(apiKeysRoutes.listExact))
                    } catch (e) {
                      handleError(e, "Saving failed")
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  Save
                </Button>
              )}
            </FormActions>
          </FormLayout>
        </Form>
      </div>
    </div>
  )
}

export const ApiKeyEditor = observer(ApiKeyEditorComponent)
