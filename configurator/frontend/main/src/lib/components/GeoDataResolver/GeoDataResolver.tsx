import { useState } from "react"
import { Button, Form, Input, Switch, Table, Tooltip } from "antd"
import { FormActions, FormField, FormLayout } from "../Form/Form"
import { useForm } from "antd/es/form/Form"
import { useServices } from "../../../hooks/useServices"
import ApplicationServices from "../../services/ApplicationServices"
import { actionNotification } from "../../../ui/components/ActionNotification/ActionNotification"
import { CenteredError, CenteredSpin, CodeInline, handleError } from "../components"
import { withQueryParams } from "../../../utils/queryParams"
import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined } from "@ant-design/icons"
import QuestionCircleOutlined from "@ant-design/icons/lib/icons/QuestionCircleOutlined"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { MaxMindConfig } from "./utils"
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

  return (
    <div className="flex justify-center w-full">
      <div className="w-full pt-8 px-4" style={{ maxWidth: "1000px" }}>
        <p>
          Jitsu uses <a href="https://www.maxmind.com/">MaxMind</a> databases for geo resolution. There are two families
          of MaxMind databases: <b>GeoIP2</b> and <b>GeoLite2</b>. After setting a license key{" "}
          <b>all available MaxMind databases, which the license key has access</b>, will be downloaded and used for
          enriching incoming events. For using a certain database add{" "}
          <CodeInline>{"?edition_id=<database type>"}</CodeInline> to MaxMind License Key value. For example:{" "}
          <CodeInline>{"M10sDzWKmnDYUBM0?edition_id=GeoIP2-City,GeoIP2-ISP"}</CodeInline>.
        </p>

        <div className="w-96 flex-wrap flex justify-content-center">
          <Table
            pagination={false}
            columns={[
              {
                title: (
                  <>
                    Database{" "}
                    <Tooltip title="Paid MaxMind Database">
                      <QuestionCircleOutlined className="label-with-tooltip_question-mark" />
                    </Tooltip>
                  </>
                ),
                dataIndex: "main",
                key: "name",
                render: databaseStatusesRepresentation,
              },
              {
                title: (
                  <>
                    Analog{" "}
                    <Tooltip title="Free MaxMind Database analog. Usually it is less accurate than paid version. It is downloaded only if paid one is unavailable.">
                      <QuestionCircleOutlined className="label-with-tooltip_question-mark" />
                    </Tooltip>
                  </>
                ),
                dataIndex: "analog",
                key: "name",
                render: databaseStatusesRepresentation,
              },
            ]}
            dataSource={formConfig.editions}
          />
        </div>

        <br />
        <Form form={form} onFinish={submit}>
          <FormLayout>
            <FormField
              label="Enabled"
              tooltip={
                <>
                  If enabled - Jitsu downloads <a href="https://www.maxmind.com/en/geoip2-databases">GeoIP Databases</a>{" "}
                  with your license key and enriches incoming JSON events with location based data. Read more
                  information about{" "}
                  <a href="https://jitsu.com/docs/other-features/geo-data-resolution">Geo data resolution</a>.
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
                  Your MaxMind licence key. Obtain a new one in your <a href="https://www.maxmind.com/">Account</a>{" "}
                  {"->"} Manage License Keys. Jitsu downloads all available MaxMind databases with your license key. If
                  you would like to enrich events JSON with the only certain MaxMind DB data{": "}
                  specify license key with the format:{" "}
                  {"<license_key>?edition_id=<comma separated editions like: GeoIP2-City,GeoIP2-ISP>"}. If you use{" "}
                  <a href="https://cloud.jitsu.com/">Jitsu.Cloud</a> and MaxMind isn't set - free GeoLite2-City and
                  GeoLite2-ASN MaxMind databases are applied. Read more about{" "}
                  <a href="https://dev.maxmind.com/geoip/geolite2-free-geolocation-data?lang=en">
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
                  size="large"
                  name="license_key"
                  placeholder="for example: M10sDzWKmnDYUBM0"
                  required={true}
                />
              </Form.Item>
            </FormField>
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
