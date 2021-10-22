import { Button, Form, Input } from "antd"
import { observer } from "mobx-react-lite"
import { apiKeysStore } from "../../../stores/apiKeys"
import { useParams } from "react-router-dom"
import { CenteredError } from "../components"
import { useForm } from "antd/es/form/Form"
import { LabelEllipsis } from "../../../ui/components/LabelEllipsis/LabelEllipsis"
import ReloadOutlined from "@ant-design/icons/lib/icons/ReloadOutlined"
import React, { Children, ReactNode, useState } from "react"
import cn from "classnames"
import { LabelWithTooltip } from "../../../ui/components/LabelWithTooltip/LabelWithTooltip"
import TextArea from "antd/es/input/TextArea"
import { BreadcrumbsProps, withHome } from "../../../ui/components/Breadcrumbs/Breadcrumbs"
import { FormInstance } from "antd/es/form/hooks/useForm"

export const apiKeysRoutes = {
  newExact: "/api-keys/new",
  listExact: "/api-keys",
  editExact: "/api-keys/:id",
} as const

type ApiKeyEditorProps = {
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void
}

function newKey(): APIKey {
  let uid = apiKeysStore.generateApiToken("", 6)
  return {
    uid: uid,
    serverAuth: apiKeysStore.generateApiToken("s2s"),
    jsAuth: apiKeysStore.generateApiToken("js"),
    comment: uid,
    origins: [],
  }
}

const formItemLayout = {
  labelCol: { span: 6 },
  wrapperCol: { span: 18 },
}

type FormFieldProps = {
  label: ReactNode
  tooltip?: ReactNode
  children: ReactNode
  splitter?: boolean
}

type FormLayoutProps = {
  title?: ReactNode
  className?: string
  children: React.ReactElement<FormFieldProps> | React.ReactElement<FormFieldProps>[]
}

const FormField: React.FC<FormFieldProps> = ({ children, label, tooltip, splitter = false }: FormFieldProps) => {
  return (
    <div className={`flex flex-wrap items-start w-full py-4 ${splitter && "border-b border-splitBorder"}`}>
      <div style={{ width: "20em", minWidth: "20em" }} className="font-semibold">
        {tooltip ? <LabelWithTooltip documentation={tooltip}>{label}</LabelWithTooltip> : label}
      </div>
      <div className="flex-grow">{children}</div>
    </div>
  )
}

// const FormActions: React.FC<{}>

const FormLayout: React.FC<FormLayoutProps> = ({ className, children, title }) => {
  return (
    <div className={cn(className, "flex flex-col justify-center")}>
      {title && <div className="text-lg">{title}</div>}
      {children}
    </div>
  )
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
        <Form.Item name={formFieldName} className="w-full">
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

const FormActions: React.FC<{}> = ({ children }) => {
  return <div className="w-full flex justify-end space-x-4">{children}</div>
}

const ApiKeyEditorComponent: React.FC<ApiKeyEditorProps> = props => {
  const { id = undefined } = useParams<{ id?: string }>()
  const initialApiKey = id ? apiKeysStore.apiKeys.find(key => key.uid === id.replace("-", ".")) : newKey()
  if (!initialApiKey) {
    return <CenteredError error={new Error(`Key with id ${id} not found`)} />
  }
  const [apiKey, setApiKey] = useState<APIKey & { originsText?: string }>({
    ...initialApiKey,
    originsText: initialApiKey.origins ? initialApiKey.origins.join('\n') : '',
    comment: initialApiKey.comment || initialApiKey.uid
  })
  const [form] = useForm<any>()
  props.setBreadcrumbs(
    withHome({
      elements: [
        {
          link: apiKeysRoutes.listExact,
          title: "Api Keys",
        },
        {
          title: id ? "Edit Key" : "Create Key",
        },
      ],
    })
  )
  form.setFieldsValue({
    ...apiKey,
    origins: undefined,
    originsText: apiKey.origins ? initialApiKey.origins.join("\n") : "",
  })
  return (
    <div className="flex justify-center w-full">
      <div className="w-full pt-8" style={{ maxWidth: "1000px" }}>
        <Form
          form={form}
          onChange={vals => {
            setApiKey({
              ...(form.getFieldsValue() as APIKey),
              originsText: undefined,
              origins: vals['originsText']
                ? vals['originsText']
                    .trim()
                    .split("\n")
                    .map(line => line.trim())
                : [],
            })
          }}>
          <FormLayout>
            <FormField label="Key Name" tooltip="Name of the key" key="comment">
              <Form.Item name="comment">
                <Input size="large" name="comment" placeholder="Key Name" required={true} />
              </Form.Item>
            </FormField>
            <SecretKey
              onGenerate={() => {
                setApiKey({
                  ...apiKey,
                  jsAuth: apiKeysStore.generateApiToken("js"),
                })
              }}
              formFieldName="jsAuth"
              formFieldLabel="Client-side (JS) key">
              The key that is user for client-side Jitsu libraries (JavaScript, iOS etc). You can consider this key as
              'public' since it is visible to any end-user
            </SecretKey>
            <SecretKey
              onGenerate={() => {
                setApiKey({
                  ...apiKey,
                  serverAuth: apiKeysStore.generateApiToken("s2s"),
                })
              }}
              formFieldName="serverAuth"
              formFieldLabel="Server-side key">
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
              key="js">
              <Form.Item name="originsText">
                <TextArea required={false} size="large" rows={10} name="originsText" />
              </Form.Item>
            </FormField>
            <FormActions>
              <Button htmlType="submit" size="large" type="default" danger onClick={() => {

              }}>
                Delete
              </Button>
              <Button htmlType="submit" size="large" type="default" onClick={() => {

              }}>
                Cancel
              </Button>
              <Button htmlType="submit" size="large" type="primary">
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
