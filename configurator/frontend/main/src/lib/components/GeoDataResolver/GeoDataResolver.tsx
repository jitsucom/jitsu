import { useState } from "react"
import { Button, Form, Input, Switch, Tag, Tooltip } from "antd"
import { FormActions, FormField, FormLayout } from "../Form/Form"
import { useForm } from "antd/es/form/Form"
import { useServices } from "../../../hooks/useServices"
import ApplicationServices from "../../services/ApplicationServices"
import { actionNotification } from "../../../ui/components/ActionNotification/ActionNotification"
import { CenteredError, CenteredSpin, CodeInline, handleError } from "../components"
import { withQueryParams } from "../../../utils/queryParams"
import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined } from "@ant-design/icons"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { Edition, MaxMindConfig } from "./utils"
import Marshal from "lib/commons/marshalling"

const geoDataResolversCollection = "geo_data_resolvers"

type GeoDataResolverFormValues = {
  enabled: boolean
  license_key: string
}

function GeoDataResolver() {
  const services = useServices()

  const [saving, setSaving] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [formDisabled, setFormDisabled] = useState(false)

  const [form] = useForm<GeoDataResolverFormValues>()

  const {
    error: loadingError,
    data: formConfig,
    setData: setFormConfig,
  } = useLoaderAsObject<MaxMindConfig>(async () => {
    const response = await services.backendApiClient.get(
      `/configurations/${geoDataResolversCollection}?id=${services.activeProject.id}`
    )

    let config = {
      license_key: response.maxmind?.license_key,
      enabled: response.maxmind?.enabled,
      editions: [],
    }

    //set statuses or load
    if (response.maxmind?.enabled && response.maxmind?._statuses) {
      config.editions = response.maxmind._statuses
    } else {
      const response = await ApplicationServices.get().backendApiClient.get(
        withQueryParams("/geo_data_resolvers/editions", { project_id: services.activeProject.id }),
        { proxy: true }
      )
      config.editions = response.editions
    }

    form.setFieldsValue({
      license_key: config.license_key,
      enabled: config.enabled,
    })

    setFormDisabled(!config.enabled)

    return config
  }, [])

  const submit = async () => {
    setSaving(true)
    let formValues = form.getFieldsValue()
    try {
      if (formValues.enabled) {
        await testConnection(true)
      }
      await save()
    } catch (error) {
      actionNotification.error(error.message || error)
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    let formValues = form.getFieldsValue()

    let config = {
      maxmind: {
        enabled: formValues.enabled,
        license_key: formValues.license_key,
        _statuses: formValues.enabled ? formConfig.editions : null,
      },
    }

    await services.backendApiClient.post(
      `/configurations/${geoDataResolversCollection}?id=${services.activeProject.id}`,
      Marshal.toPureJson(config)
    )

    let anyConnected =
      formConfig.editions.filter(editionStatus => {
        return editionStatus.main.status === "ok" || editionStatus.analog?.status === "ok"
      }).length > 0

    if (!formValues.enabled || anyConnected) {
      actionNotification.success("Settings saved!")
    }

    if (formValues.enabled && !anyConnected) {
      actionNotification.warn(
        `Settings have been saved, but there is no available MaxMind database for this license key. Geo Resolution won't be applied to your JSON events`
      )
    }
  }

  const testConnection = async (hideMessage?: boolean) => {
    setTestingConnection(true)

    let formValues = form.getFieldsValue()

    try {
      const response = await ApplicationServices.get().backendApiClient.post(
        withQueryParams("/geo_data_resolvers/test", { project_id: services.activeProject.id }),
        { maxmind_url: formValues.license_key },
        {
          proxy: true,
        }
      )

      if (response.message) throw new Error(response.message)

      //enrich state
      let currentFormConfig = formConfig
      currentFormConfig.editions = response.editions
      setFormConfig(currentFormConfig)

      //show notification
      if (!hideMessage) {
        let anyConnected =
          formConfig.editions.filter(editionStatus => {
            return editionStatus.main.status === "ok" || editionStatus.analog?.status === "ok"
          }).length > 0

        if (anyConnected) {
          actionNotification.success("Successfully connected!")
        } else {
          actionNotification.error("Connection failed: there is no available MaxMind database for this license key")
        }
      }
    } catch (error) {
      if (!hideMessage) {
        handleError(error, "Connection failed")
      }
    } finally {
      setTestingConnection(false)
    }
  }

  const databaseStatusesRepresentation = (dbStatus: any) => {
    let body = <>-</>
    if (dbStatus) {
      let icon = (
        <Tooltip title="Not connected yet">
          <ClockCircleOutlined className="text-secondaryText" />
        </Tooltip>
      )

      if (dbStatus.status === "ok") {
        icon = (
          <Tooltip title="Successfully connected">
            <CheckCircleOutlined className="text-success" />
          </Tooltip>
        )
      } else if (dbStatus.status === "error") {
        icon = (
          <Tooltip title={dbStatus.message}>
            <CloseCircleOutlined className="text-error" />
          </Tooltip>
        )
      }

      body = (
        <>
          {dbStatus.name}: {icon}
        </>
      )
    }

    return body
  }

  if (loadingError) {
    return <CenteredError error={loadingError} />
  } else if (!formConfig) {
    return <CenteredSpin />
  }

  const editionTagRender = (edition: Edition) => {
    if (edition.main.status === "unknown" && (!edition.analog || edition.analog.status === "unknown")) {
      let name = edition.main.name.split("-")[1]
      if (name === "ISP") {
        name = "ISP or ASN"
      }
      return (
        <span className="opacity-70">
          <Tooltip title="Not connected yet">
            <Tag icon={<ClockCircleOutlined className="text-secondaryText" />}>{name}</Tag>
          </Tooltip>
        </span>
      )
    }
    return ["main", "analog"].map(type => {
      const db = edition[type]

      // if main base has ok status - don't show analog base
      if (type === "analog" && edition["main"].status === "ok") {
        return null
      }
      // if analog base has ok status - don't show main base
      if (type === "main" && edition["analog"]?.status === "ok") {
        return null
      }

      if (!db?.name || db?.status === "unknown") {
        return null
      }

      const messages = { ok: "Successfully connected", error: db.message }
      const icons = {
        ok: <CheckCircleOutlined className="text-success" />,
        error: <CloseCircleOutlined className="text-error" />,
      }
      const colors = { ok: "green", error: "red" }
      return (
        <Tooltip title={messages[db.status] ?? "Not connected yet"} color={colors[db.status] ?? null}>
          <Tag
            className={db.status === "unknown" ? "opacity-70" : null}
            color={colors[db.status] ?? null}
            icon={icons[db.status] ?? <ClockCircleOutlined className="text-secondaryText" />}
          >
            {db.name}{" "}
          </Tag>
        </Tooltip>
      )
    })
  }

  return (
    <div className="flex justify-center w-full">
      <div className="w-full pt-8 px-4" style={{ maxWidth: "1000px" }}>
        <p>
          Jitsu uses{" "}
          <a target="_blank" href="https://www.maxmind.com/">
            MaxMind
          </a>{" "}
          databases for geo resolution. There are two families of MaxMind databases: <b>GeoIP2</b> and <b>GeoLite2</b>.
          After setting a license key <b>all available MaxMind databases, which the license key has access</b>, will be
          downloaded and used for enriching incoming events. For using a certain database add{" "}
          <CodeInline>{"?edition_id=<database type>"}</CodeInline> to MaxMind License Key value. For example:{" "}
          <CodeInline>{"M10sDzWKmnDYUBM0?edition_id=GeoIP2-City,GeoIP2-ISP"}</CodeInline>.
        </p>

        <Form form={form} onFinish={submit}>
          <FormLayout>
            <FormField
              label="Enabled"
              tooltip={
                <>
                  If enabled - Jitsu downloads{" "}
                  <a target="_blank" href="https://www.maxmind.com/en/geoip2-databases">
                    GeoIP Databases
                  </a>{" "}
                  with your license key and enriches incoming JSON events with location based data. Read more
                  information about{" "}
                  <a target="_blank" href="https://jitsu.com/docs/other-features/geo-data-resolution">
                    Geo data resolution
                  </a>
                  .
                </>
              }
              key="enabled"
            >
              <Form.Item name="enabled" valuePropName="checked">
                <Switch
                  onChange={value => {
                    setFormDisabled(!value)
                  }}
                  size="default"
                />
              </Form.Item>
            </FormField>
            <FormField
              label="MaxMind License Key"
              tooltip={
                <>
                  Your MaxMind licence key. Obtain a new one in your{" "}
                  <a target="_blank" href="https://www.maxmind.com/">
                    Account
                  </a>{" "}
                  {"->"} Manage License Keys. Jitsu downloads all available MaxMind databases with your license key. If
                  you would like to enrich events JSON with the only certain MaxMind DB data{": "}
                  specify license key with the format:{" "}
                  {"<license_key>?edition_id=<comma separated editions like: GeoIP2-City,GeoIP2-ISP>"}. If you use{" "}
                  <a target="_blank" href="https://cloud.jitsu.com/">
                    Jitsu.Cloud
                  </a>{" "}
                  and MaxMind isn't set - free GeoLite2-City and GeoLite2-ASN MaxMind databases are applied. Read more
                  about{" "}
                  <a target="_blank" href="https://dev.maxmind.com/geoip/geolite2-free-geolocation-data?lang=en">
                    free MaxMind databases
                  </a>
                  .{" "}
                </>
              }
              key="license_key"
            >
              <Form.Item name="license_key">
                <Input
                  disabled={formDisabled}
                  name="license_key"
                  placeholder="for example: M10sDzWKmnDYUBM0"
                  required={true}
                />
              </Form.Item>
            </FormField>
            <div className="flex flex-nowrap items-start w-full py-4 false">
              <div className="font-semibold" style={{ width: "20em", minWidth: "20em" }}>
                <span>Databases</span>
              </div>

              <div className="flex-grow mb-6">
                <div className="flex-wrap flex justify-content-center mb-3">
                  {formConfig.editions.map(db => editionTagRender(db))}
                </div>
              </div>
            </div>
            <FormActions>
              <Button
                size="large"
                className="mr-3"
                type="dashed"
                loading={testingConnection}
                onClick={() => testConnection()}
                icon={<ApiOutlined />}
                disabled={formDisabled}
              >
                Test connection
              </Button>
              <Button loading={saving} htmlType="submit" size="large" type="primary">
                Save
              </Button>
            </FormActions>
          </FormLayout>
        </Form>
      </div>
    </div>
  )
}

export default GeoDataResolver
