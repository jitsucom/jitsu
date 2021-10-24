// @Libs
import React, { ReactNode, useState } from "react"
import { flowResult } from "mobx"
import { Observer, observer } from "mobx-react-lite"
import { Button, Drawer, Input, Menu, message, Modal, Popover, Select, Space, Switch, Table, Tabs, Tooltip } from "antd"
// @Components
import {
  ActionLink,
  CenteredError,
  CenteredSpin,
  CodeInline,
  CodeSnippet,
  handleError,
} from "../components"
import { getCurlDocumentation, getEmbeddedHtml, getNPMDocumentation } from "../../commons/api-documentation"
import TagsInput from "../TagsInput/TagsInput"
import { LabelWithTooltip } from "ui/components/LabelWithTooltip/LabelWithTooltip"
// @Store
import { apiKeysStore, UserApiKey } from "stores/apiKeys"
// @Services
import { useServices } from "hooks/useServices"
// @Icons
import CodeFilled from "@ant-design/icons/lib/icons/CodeFilled"
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
import DeleteFilled from "@ant-design/icons/lib/icons/DeleteFilled"
import ReloadOutlined from "@ant-design/icons/lib/icons/ReloadOutlined"
import ExclamationCircleOutlined from "@ant-design/icons/lib/icons/ExclamationCircleOutlined"
// @Utils
import {
  copyToClipboard,
  copyToClipboard as copyToClipboardUtility,
  reactElementToString,
  trimMiddle,
} from "../../commons/utils"
// @Hooks
import useLoader from "hooks/useLoader"
// @Styles
import "./ApiKeys.less"
import styles from "./ApiKeys.module.less"
import { default as JitsuClientLibraryCard, jitsuClientLibraries } from "../JitsuClientLibrary/JitsuClientLibrary"
import { Code } from "../Code/Code"
import { ConnectionCard } from "../../../ui/components/ConnectionCard/ConnectionCard"
import { apiKeysReferenceMap } from "../../../catalog/apiKeys/lib"
import { ConfigurationEntitiesTable } from "../../services/ServerStorage"
import { actionNotification } from "../../../ui/components/ActionNotification/ActionNotification"
import { DeleteOutlined } from "@ant-design/icons"

/**
 * What's displayed as loading?
 * - number - index of key,
 * - "NEW" - new button,
 * - null - nothing
 */
type LoadingState = number | "NEW" | null


type ApiKeyCardProps = {
  apiKey: UserApiKey
  showDocumentation: () => void
}

function ApiKeyCard({ apiKey: key, showDocumentation }: ApiKeyCardProps) {
  const [loading, setLoading] = useState(false)
  const services = useServices()
  let keysBackend = services.storageService.table<APIKey>("api_keys")
  const rotateKey = async (key: UserApiKey, type: "jsAuth" | "serverAuth"): Promise<string> => {
    let newKey = apiKeysStore.generateApiToken(type === "jsAuth" ? "js" : "s2s")
    await keysBackend.patch(key.uid, { [type]: newKey })
    await flowResult(apiKeysStore.pullApiKeys())
    message.info("New key has been generated and saved")
    return newKey
  }

  let deleteKey = async () => {
    setLoading(true)
    try {
      await keysBackend.remove(key.uid)
      await flowResult(apiKeysStore.pullApiKeys())
    } finally {
      setLoading(false)
    }
  }
  return (
    <ConnectionCard
      loading={loading}
      title={key.comment || key.uid}
      icon={apiKeysReferenceMap.js.icon}
      deleteAction={deleteKey}
      editAction={undefined}
      menuOverlay={<Menu>
        <Menu.Item icon={<DeleteOutlined />} onClick={deleteKey}>
          Delete
        </Menu.Item>
      </Menu>}
      rename={async newName => {
        await keysBackend.patch(key.uid, { comment: newName })
        await flowResult(apiKeysStore.pullApiKeys())
      }}
      subtitle={<a onClick={showDocumentation}>Show connection instructions→</a>}
      status={
        <>
          <div className="text-xs">
            <div className="flex flex-nowrap items-center">
              <span className="inline-block whitespace-nowrap w-16 text-xxs">Server Key</span>{" "}
              <SecretKey rotateKey={() => rotateKey(key, "serverAuth")}>{key.serverAuth}</SecretKey>
            </div>
            <div className="flex flex-nowrap items-center pt-2">
              <span className="inline-block whitespace-nowrap w-16 text-xxs">JS Key</span>
              <SecretKey rotateKey={() => rotateKey(key, "jsAuth")}>{key.jsAuth}</SecretKey>
            </div>
          </div>
        </>
      }
    />
  )
}

const ApiKeysComponent: React.FC = () => {
  const keys = apiKeysStore.apiKeys
  const services = useServices()
  services.storageService.table("api_keys")
  let keysBackend = services.storageService.table<APIKey>("api_keys")

  const [loading, setLoading] = useState<LoadingState>(null)
  const [documentationDrawerKey, setDocumentationDrawerKey] = useState<UserApiKey>(null)

  const header = (
    <div className="flex flex-row mb-5 items-start justify between">
      <div className="flex-grow flex text-secondaryText">
        Jitsu supports many{" "}
        <Popover
          trigger="click"
          placement="bottom"
          title={null}
          content={
            <div className="w-96 flex-wrap flex justify-center">
              {Object.values(jitsuClientLibraries).map(props => (
                <div className="mx-3 my-4" key={props.name}>
                  <JitsuClientLibraryCard {...props} />
                </div>
              ))}
            </div>
          }>
          {"\u00A0"}
          <a>languages and frameworks</a>
          {"\u00A0"}
        </Popover>
        !
      </div>
      <div className="flex-shrink">
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          loading={"NEW" === loading}
          onClick={async () => {
            setLoading("NEW")
            try {
              await keysBackend.add({
                uid: apiKeysStore.generateApiToken("", 6),
                serverAuth: apiKeysStore.generateApiToken("s2s"),
                jsAuth: apiKeysStore.generateApiToken("js"),
                origins: [],
              })
              await flowResult(apiKeysStore.pullApiKeys())
              actionNotification.info("New API key has been saved!")
            } catch (error) {
              actionNotification.error(`Failed to add new token: ${error.message || error}`)
            } finally {
              setLoading(null)
            }
          }}>
          Generate New Key
        </Button>
      </div>
    </div>
  )

  return (
    <>
      {header}
      <div className="flex flex-wrap justify-center">
        {keys
          .slice()
          .reverse()
          .map(key => (
            <ApiKeyCard apiKey={key} key={key.uid} showDocumentation={() => setDocumentationDrawerKey(key)} />
          ))}
      </div>
      <Drawer width="70%" visible={!!documentationDrawerKey} onClose={() => setDocumentationDrawerKey(null)}>
        {documentationDrawerKey && <KeyDocumentation token={documentationDrawerKey} />}
      </Drawer>
    </>
  )
}

type SecretKeyProps = {
  //Key
  children: ReactNode
  //Function that generates newKey
  rotateKey: () => Promise<string>
}

function SecretKey({ children, rotateKey }: SecretKeyProps) {
  let keyStr = reactElementToString(children)
  const [currentKeyDisplay, setCurrentKeyDisplay] = useState(keyStr)

  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-nowrap flex w-78">
      <Tooltip
        overlayClassName={`${styles.keyTooltip}`}
        trigger={"click"}
        overlay={
          <div className="flex flex-nowrap items-center space-x-4 justify-center">
            <span className="text-base font-semibold rounded font-monospace text-secondaryText">{children}</span>
            <Button
              size="middle"
              onClick={() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1000)
                copyToClipboard(keyStr)
              }}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        }>
        <span className="cursor-pointer border px-1 py-0.5 mr-0.5 rounded font-monospace text-secondaryText flex-grow w-56 text-center">
          {trimMiddle(currentKeyDisplay, 29, "•••")}
        </span>
      </Tooltip>
      <Button
        size="small"
        type="link"
        icon={<ReloadOutlined />}
        onClick={() => {
          Modal.confirm({
            title: "Please confirm key rotation",
            icon: <ExclamationCircleOutlined />,
            content:
              "Are you sure you want to rotate the key? Previously generated key will be lost and you'll need to reconfigure ALL clients",
            okText: "Generate new key",
            cancelText: "Cancel",
            onOk: async () => {
              setCurrentKeyDisplay("Generating...")
              try {
                let newKey = await rotateKey()
                setCurrentKeyDisplay(newKey)
              } catch (e) {
                setCurrentKeyDisplay("Error!")
                console.log(e)
              }
            },
            onCancel: () => {},
          })
        }}
      />
    </div>
  )
}

export function getDomainsSelectionByEnv(env: string) {
  return env === "heroku" ? [location.protocol + "//" + location.host] : []
}

type KeyDocumentationProps = {
  token: UserApiKey
  displayDomainDropdown?: boolean
}

export const KeyDocumentation: React.FC<KeyDocumentationProps> = function ({ token, displayDomainDropdown = true }) {
  const [segment, setSegmentEnabled] = useState<boolean>(false)
  const services = useServices()
  const staticDomains = getDomainsSelectionByEnv(services.features.environment)
  console.log(`As per ${services.features.environment} available static domains are: ` + staticDomains)
  const [selectedDomain, setSelectedDomain] = useState<string | null>(
    staticDomains.length > 0 ? staticDomains[0] : null
  )
  const [error, domains] = services.features.enableCustomDomains
    ? useLoader(async () => {
        const result = await services.storageService.get("custom_domains", services.activeProject.id)
        const customDomains = result?.domains?.map(domain => "https://" + domain.name) || []
        const newDomains = [...customDomains, "https://t.jitsu.com"]
        setSelectedDomain(newDomains[0])
        return newDomains
      })
    : [null, staticDomains]

  if (error) {
    handleError(error, "Failed to load data from server")
    return <CenteredError error={error} />
  } else if (!domains) {
    return <CenteredSpin />
  }
  console.log(`Currently selected domain is: ${selectedDomain}`)

  const exampleSwitches = (
    <div className="api-keys-doc-embed-switches">
      <Space>
        <LabelWithTooltip
          documentation={
            <>
              Check if you want to intercept events from Segment (
              <a href="https://jitsu.com/docs/sending-data/js-sdk/snippet#intercepting-segment-events">Read more</a>)
            </>
          }
          render="Intercept Segment events"
        />
        <Switch size="small" checked={segment} onChange={() => setSegmentEnabled(!segment)} />
      </Space>
    </div>
  )

  const documentationDomain = selectedDomain || services.features.jitsuBaseUrl || "REPLACE_WITH_JITSU_DOMAIN"
  return (
    <Tabs
      className="api-keys-documentation-tabs pt-8"
      defaultActiveKey="1"
      tabBarExtraContent={
        <>
          {domains.length > 0 && displayDomainDropdown && (
            <>
              <LabelWithTooltip documentation="Domain" render="Domain" />:{" "}
              <Select defaultValue={domains[0]} onChange={value => setSelectedDomain(value)}>
                {domains.map(domain => {
                  return <Select.Option value={domain}>{domain.replace("https://", "")}</Select.Option>
                })}
              </Select>
            </>
          )}
        </>
      }>
      <Tabs.TabPane tab="Embed JavaScript" key="1">
        <p className="api-keys-documentation-tab-description">
          Easiest way to start tracking events within your web app is to add following snippet to{" "}
          <CodeInline>&lt;head&gt;</CodeInline> section of your html file.{" "}
          <a href="https://jitsu.com/docs/sending-data/js-sdk/">Read more</a> about JavaScript integration on our
          documentation website
        </p>
        <Code className="bg-bgSecondary py-3 px-5 rounded-xl mb-2" language="html">
          {getEmbeddedHtml(segment, token.jsAuth, documentationDomain)}
        </Code>
        {exampleSwitches}
      </Tabs.TabPane>
      <Tabs.TabPane tab="Use NPM/YARN" key="2">
        <p className="api-keys-documentation-tab-description">
          Use <CodeInline>npm install --save @jitsu/sdk-js</CodeInline> or{" "}
          <CodeInline>yarn add @jitsu/sdk-js</CodeInline>. Read more{" "}
          <a href="https://jitsu.com/docs/sending-data/js-sdk/package">about configuration properties</a>
        </p>
        <Code className="bg-bgSecondary py-3 px-5 rounded-xl mb-2" language="javascript">
          {getNPMDocumentation(token.jsAuth, documentationDomain)}
        </Code>
      </Tabs.TabPane>
      <Tabs.TabPane tab="Server to server" key="3">
        <p className="api-keys-documentation-tab-description">
          Events can be send directly to Api end-point. In that case, server secret should be used. Please, see curl
          example:
        </p>
        <Code className="bg-bgSecondary py-3 px-5  rounded-xl mb-2" language="bash">
          {getCurlDocumentation(token.serverAuth, documentationDomain)}
        </Code>
      </Tabs.TabPane>
    </Tabs>
  )
}

const ApiKeys = observer(ApiKeysComponent)

ApiKeys.displayName = "ApiKeys"

export default ApiKeys
