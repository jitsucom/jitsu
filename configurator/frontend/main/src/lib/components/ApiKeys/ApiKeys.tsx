// @Libs
import React, { useState } from "react"
import { flowResult } from "mobx"
import { observer } from "mobx-react-lite"
import { Button, Drawer, Popover, Select, Space, Switch, Tabs } from "antd"
// @Components
import { CenteredError, CenteredSpin, CodeInline, handleError } from "../components"
import { getCurlDocumentation, getEmbeddedHtml, getNPMDocumentation } from "../../commons/api-documentation"
import { LabelWithTooltip } from "ui/components/LabelWithTooltip/LabelWithTooltip"
// @Store
import { apiKeysStore } from "stores/apiKeys"
// @Services
import { useServices } from "hooks/useServices"
// @Icons
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
// @Utils
// @Hooks
import useLoader from "hooks/useLoader"
// @Styles
import "./ApiKeys.less"
import { default as JitsuClientLibraryCard, jitsuClientLibraries } from "../JitsuClientLibrary/JitsuClientLibrary"
import { Code } from "../Code/Code"
import { actionNotification } from "../../../ui/components/ActionNotification/ActionNotification"
import { ApiKeyCard } from "./ApiKeyCard"
import { Link } from "react-router-dom"

/**
 * What's displayed as loading?
 * - number - index of key,
 * - "NEW" - new button,
 * - null - nothing
 */
type LoadingState = number | "NEW" | null

const ApiKeysComponent: React.FC = () => {
  const keys = apiKeysStore.apiKeys
  const services = useServices()
  services.storageService.table("api_keys")
  let keysBackend = services.storageService.table<APIKey>("api_keys")

  const [loading, setLoading] = useState<LoadingState>(null)
  const [documentationDrawerKey, setDocumentationDrawerKey] = useState<APIKey>(null)

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
          }
        >
          {"\u00A0"}
          <a>languages and frameworks</a>
          {"\u00A0"}
        </Popover>
        !
      </div>
      <div className="flex-shrink">
        <Link to={"/api-keys/new"}>
          <Button type="primary" size="large" icon={<PlusOutlined />} loading={"NEW" === loading}>
            Generate New Key
          </Button>
        </Link>
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

export function getDomainsSelectionByEnv(env: string) {
  return env === "heroku" ? [location.protocol + "//" + location.host] : []
}

type KeyDocumentationProps = {
  token: APIKey
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
      }
    >
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
