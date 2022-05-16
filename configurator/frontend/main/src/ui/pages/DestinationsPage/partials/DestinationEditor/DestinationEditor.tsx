// @Libs
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Prompt, useHistory, useLocation, useParams } from "react-router-dom"
import { Button, Card, Form } from "antd"
import { flowResult } from "mobx"
import cn from "classnames"
// @Components
import { TabsConfigurator } from "ui/components/Tabs/TabsConfigurator"
import { EditorButtons } from "ui/components/EditorButtons/EditorButtons"
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { DestinationEditorConfig } from "./DestinationEditorConfig"
import { DestinationEditorTransform } from "./DestinationEditorTransform"
import { DestinationEditorConnectors } from "./DestinationEditorConnectors"
import { DestinationEditorMappings } from "./DestinationEditorMappings"
// @Store
import { sourcesStore } from "stores/sources"
import { destinationsStore } from "stores/destinations"
// @CatalogDestinations
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"
// @Types
import { FormInstance } from "antd/es"
import { Destination } from "@jitsu/catalog/destinations/types"
import { Tab } from "ui/components/Tabs/TabsConfigurator"
import { CommonDestinationPageProps } from "ui/pages/DestinationsPage/DestinationsPage"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Routes
import { destinationPageRoutes } from "ui/pages/DestinationsPage/DestinationsPage.routes"
// @Styles
import styles from "./DestinationEditor.module.less"
// @Utils
import { makeObjectFromFieldsValues } from "utils/forms/marshalling"
import { destinationEditorUtils } from "ui/pages/DestinationsPage/partials/DestinationEditor/DestinationEditor.utils"
import { getUniqueAutoIncId, randomId } from "utils/numbers"
import { firstToLower } from "lib/commons/utils"
// @Hooks
import { useForceUpdate } from "hooks/useForceUpdate"
// @Icons
import { AreaChartOutlined, WarningOutlined } from "@ant-design/icons"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { currentPageHeaderStore } from "stores/currentPageHeader"
import { connectionsHelper } from "stores/helpers"
import { EntityNotFound } from "ui/components/EntityNotFound/EntityNotFound"

type DestinationTabKey = "config" | "transform" | "mappings" | "sources" | "settings" | "statistics"

type DestinationParams = {
  type?: DestinationType
  id?: string
  tabName?: string
  //For editor that lives separately from destination list page
  standalone?: string
}

type DestinationURLParams = {
  type?: string
  id?: string
  tabName?: string
  //For editor that lives separately from destination list page
  standalone?: string
}

type ConfigProps = { paramsByProps?: DestinationParams }

type ControlsProps = {
  disableForceUpdateOnSave?: boolean
  onAfterSaveSucceded?: () => void
  onCancel?: () => void
  isOnboarding?: boolean
}

type Props = CommonDestinationPageProps & ConfigProps & ControlsProps

const DestinationEditor = ({
  editorMode,
  paramsByProps,
  disableForceUpdateOnSave,
  onAfterSaveSucceded,
  onCancel,
  isOnboarding,
}: Props) => {
  const history = useHistory()
  const { search } = useLocation()

  const forceUpdate = useForceUpdate()

  const services = ApplicationServices.get()

  const urlParams = useParams<DestinationURLParams>()
  const params = paramsByProps || urlParams

  const [activeTabKey, setActiveTabKey] = useState<DestinationTabKey>("config")
  const [savePopover, switchSavePopover] = useState<boolean>(false)
  const [testConnecting, setTestConnecting] = useState<boolean>(false)
  const [destinationSaving, setDestinationSaving] = useState<boolean>(false)
  const [testConnectingPopover, switchTestConnectingPopover] = useState<boolean>(false)

  const sources = sourcesStore.list
  const destinationData = useRef<DestinationData>(getDestinationData(params))

  const submittedOnce = useRef<boolean>(false)

  useEffect(() => {
    const query = new URLSearchParams(search)
    if (query.has("debugger")) {
      const activeTabKey = query.get("debugger").includes("transform") ? "transform" : "config"
      setActiveTabKey(activeTabKey)
    }
  }, [search])

  const destinationReference = useMemo<Destination | null | undefined>(() => {
    if (params.type) {
      return destinationsReferenceMap[params.type]
    }
    return destinationsReferenceMap[getDestinationData(params)._type]
  }, [params.type, params.id])

  if (!destinationReference) {
    return (
      <EntityNotFound
        entityDisplayType="Destination"
        entityId={params.id}
        entitiesListRoute={destinationPageRoutes.root}
      />
    )
  }

  const handleUseLibrary = async (newMappings: DestinationMapping, newTableName?: string) => {
    destinationData.current = {
      ...destinationData.current,
      _formData: {
        ...destinationData.current._formData,
        tableName: newTableName ? newTableName : destinationData.current._formData?.tableName,
      },
      _mappings: newMappings,
    }

    const { form: mappingsForm } = destinationsTabs[2]
    const { form: configForm } = destinationsTabs[0]

    await mappingsForm.setFieldsValue({
      "_mappings._mappings": newMappings._mappings,
      "_mappings._keepUnmappedFields": newMappings._keepUnmappedFields,
    })

    destinationsTabs[2].touched = true

    if (newTableName) {
      await configForm.setFieldsValue({
        "_formData.tableName": newTableName,
      })

      destinationsTabs[0].touched = true
    }

    await forceUpdate()

    actionNotification.success("Mappings library has been successfully set")
  }

  const validateTabForm = useCallback(
    async (tab: Tab) => {
      const tabForm = tab.form

      try {
        if (tab.key === "sources") {
          const _sources = tabForm.getFieldsValue()?._sources

          if (!_sources) {
            tab.errorsCount = 1
          }
        }

        tab.errorsCount = 0

        return await tabForm.validateFields()
      } catch (errors) {
        // ToDo: check errors count for fields with few validation rules
        tab.errorsCount = errors.errorFields?.length
        return null
      } finally {
        forceUpdate()
      }
    },
    [forceUpdate]
  )
  const configForm = Form.useForm()[0]
  const hideMapping =
    params.standalone == "true" ||
    isOnboarding ||
    editorMode === "add" ||
    (destinationsReferenceMap[destinationReference.id].defaultTransform.length > 0 &&
      !destinationData.current._mappings?._mappings) ||
    !destinationData.current._mappings?._mappings
  let mappingForm = undefined
  if (!hideMapping) {
    mappingForm = Form.useForm()[0]
  }

  const tabsInitialData: Tab<DestinationTabKey>[] = [
    {
      key: "config",
      name: "Connection Properties",
      getComponent: (form: FormInstance) => (
        <DestinationEditorConfig
          form={form}
          destinationReference={destinationReference}
          destinationData={destinationData.current}
          handleTouchAnyField={validateAndTouchField(0)}
        />
      ),
      form: configForm,
      touched: false,
    },
    {
      key: "transform",
      name: "Transform",
      getComponent: (form: FormInstance) => (
        <DestinationEditorTransform
          form={form}
          configForm={configForm}
          mappingForm={mappingForm}
          destinationReference={destinationReference}
          destinationData={destinationData.current}
          handleTouchAnyField={validateAndTouchField(1)}
        />
      ),
      form: Form.useForm()[0],
      touched: false,
      isHidden: params.standalone == "true",
    },
    {
      key: "mappings",
      name: "Mappings (Deprecated)",
      isDisabled: destinationData.current["_transform_enabled"],
      getComponent: (form: FormInstance) => (
        <DestinationEditorMappings
          form={form}
          initialValues={destinationData.current._mappings}
          handleTouchAnyField={validateAndTouchField(2)}
          handleDataUpdate={handleUseLibrary}
        />
      ),
      form: mappingForm,
      touched: false,
      isHidden: hideMapping,
    },
    {
      key: "sources",
      name: "Linked Connectors & API Keys",
      getComponent: (form: FormInstance) => (
        <DestinationEditorConnectors
          form={form}
          initialValues={destinationData.current}
          destination={destinationReference}
          handleTouchAnyField={validateAndTouchField(3)}
        />
      ),
      form: Form.useForm()[0],
      errorsLevel: "warning",
      touched: false,
      isHidden: params.standalone == "true",
    },
  ]

  const [destinationsTabs, setDestinationsTabs] = useState<Tab<DestinationTabKey>[]>(tabsInitialData)

  const validateAndTouchField = useCallback(
    (index: number) => (value: boolean) => {
      destinationsTabs[index].touched = value === undefined ? true : value

      setDestinationsTabs(oldTabs => {
        let tab = oldTabs[index]
        let oldErrorsCount = tab.errorsCount
        let newErrorsCount = tab.form.getFieldsError().filter(a => a.errors?.length > 0).length
        if (newErrorsCount != oldErrorsCount) {
          tab.errorsCount = newErrorsCount
        }
        if (
          oldTabs[1].form.getFieldValue("_transform_enabled") !== oldTabs[2].isDisabled ||
          newErrorsCount != oldErrorsCount
        ) {
          const newTabs = [
            ...oldTabs.slice(0, 2),
            { ...oldTabs[2], isDisabled: oldTabs[1].form.getFieldValue("_transform_enabled") },
            ...oldTabs.slice(3),
          ]
          if (newErrorsCount != oldErrorsCount) {
            newTabs[index].errorsCount = newErrorsCount
          }
          return newTabs
        } else {
          return oldTabs
        }
      })
    },
    [validateTabForm, destinationsTabs, setDestinationsTabs]
  )

  const handleCancel = useCallback(() => {
    onCancel ? onCancel() : history.push(projectRoute(destinationPageRoutes.root))
  }, [history, onCancel])

  const handleViewStatistics = () =>
    history.push(
      projectRoute(destinationPageRoutes.statisticsExact, {
        id: destinationData.current._id,
      })
    )

  const testConnectingPopoverClose = useCallback(() => switchTestConnectingPopover(false), [])

  const savePopoverClose = useCallback(() => switchSavePopover(false), [])

  const handleTestConnection = useCallback(async () => {
    setTestConnecting(true)

    const tab = destinationsTabs[0]

    try {
      const config = await validateTabForm(tab)
      const values = makeObjectFromFieldsValues<DestinationData>(config)
      destinationData.current._formData = values._formData
      destinationData.current._package = values._package
      destinationData.current._super_type = values._super_type
      await destinationEditorUtils.testConnection(destinationData.current)
    } catch (error) {
      switchTestConnectingPopover(true)
    } finally {
      setTestConnecting(false)
      forceUpdate()
    }
  }, [validateTabForm, forceUpdate])

  const handleSaveDestination = useCallback(() => {
    submittedOnce.current = true

    setDestinationSaving(true)

    Promise.all(destinationsTabs.filter((tab: Tab) => !!tab.form).map((tab: Tab) => validateTabForm(tab)))
      .then(async allValues => {
        destinationData.current = {
          ...destinationData.current,
          ...allValues.reduce((result: any, current: any) => {
            return {
              ...result,
              ...makeObjectFromFieldsValues(current),
            }
          }, {}),
        }

        try {
          await destinationEditorUtils.testConnection(destinationData.current, true)

          let savedDestinationData: DestinationData = destinationData.current
          if (editorMode === "add") {
            savedDestinationData = await flowResult(destinationsStore.add(destinationData.current))
          }
          if (editorMode === "edit") {
            await flowResult(destinationsStore.replace(destinationData.current))
          }
          await connectionsHelper.updateSourcesConnectionsToDestination(
            savedDestinationData._uid,
            savedDestinationData._sources || []
          )

          destinationsTabs.forEach((tab: Tab) => (tab.touched = false))

          if (savedDestinationData._connectionTestOk) {
            if (editorMode === "add") actionNotification.success(`New ${savedDestinationData._type} has been added!`)
            if (editorMode === "edit") actionNotification.success(`${savedDestinationData._type} has been saved!`)
          } else {
            actionNotification.warn(
              `${savedDestinationData._type} has been saved, but test has failed with '${firstToLower(
                savedDestinationData._connectionErrorMessage
              )}'. Data will not be piped to this destination`
            )
          }

          onAfterSaveSucceded ? onAfterSaveSucceded() : history.push(projectRoute(destinationPageRoutes.root))
        } catch (errors) {}
      })
      .catch(() => {
        switchSavePopover(true)
      })
      .finally(() => {
        setDestinationSaving(false)
        !disableForceUpdateOnSave && forceUpdate()
      })
  }, [
    destinationsTabs,
    destinationData,
    sources,
    history,
    validateTabForm,
    forceUpdate,
    editorMode,
    services.activeProject.id,
    services.storageService,
  ])

  const connectedSourcesNum = sources.filter(src =>
    (src.destinations || []).includes(destinationData.current._uid)
  ).length

  const isAbleToConnectItems = (): boolean =>
    editorMode === "edit" &&
    connectedSourcesNum === 0 &&
    !destinationData.current?._onlyKeys?.length &&
    !destinationsReferenceMap[params.type]?.hidden

  useEffect(() => {
    let breadcrumbs = []
    if (!params.standalone) {
      breadcrumbs.push({
        title: "Destinations",
        link: projectRoute(destinationPageRoutes.root),
      })
    }
    breadcrumbs.push({
      title: (
        <PageHeader
          title={destinationReference?.displayName ?? "Not Found"}
          icon={destinationReference?.ui.icon}
          mode={params.standalone ? "edit" : editorMode}
        />
      ),
    })
    currentPageHeaderStore.setBreadcrumbs(...breadcrumbs)
  }, [destinationReference])

  return (
    <>
      <div className={cn("flex flex-col items-stretch flex-auto", styles.wrapper)}>
        <div className={styles.mainArea} id="dst-editor-tabs">
          {isAbleToConnectItems() && (
            <Card className={styles.linkedWarning}>
              <WarningOutlined className={styles.warningIcon} />
              <article>
                This destination is not linked to any API keys or Connector. You{" "}
                <span className={styles.pseudoLink} onClick={() => setActiveTabKey("sources")}>
                  can link the destination here
                </span>
                .
              </article>
            </Card>
          )}
          <TabsConfigurator
            type="card"
            className={styles.tabCard}
            tabsList={destinationsTabs}
            activeTabKey={activeTabKey}
            onTabChange={setActiveTabKey}
            tabBarExtraContent={
              !params.standalone &&
              !isOnboarding &&
              editorMode == "edit" && (
                <Button
                  size="large"
                  className="mr-3"
                  type="link"
                  onClick={handleViewStatistics}
                  icon={<AreaChartOutlined />}
                >
                  Statistics
                </Button>
              )
            }
          />
        </div>

        <div className="flex-shrink border-t py-2">
          <EditorButtons
            save={{
              isRequestPending: destinationSaving,
              isPopoverVisible: savePopover && destinationsTabs.some((tab: Tab) => tab.errorsCount > 0),
              handlePress: handleSaveDestination,
              handlePopoverClose: savePopoverClose,
              titleText: "Destination editor errors",
              tabsList: destinationsTabs,
            }}
            test={{
              isRequestPending: testConnecting,
              isPopoverVisible: testConnectingPopover && destinationsTabs[0].errorsCount > 0,
              handlePress: handleTestConnection,
              handlePopoverClose: testConnectingPopoverClose,
              titleText: "Connection Properties errors",
              tabsList: [destinationsTabs[0]],
            }}
            handleCancel={params.standalone ? undefined : handleCancel}
          />
        </div>
      </div>

      <Prompt message={(location, action) => destinationEditorUtils.getPromptMessage(destinationsTabs, location)} />
    </>
  )
}

DestinationEditor.displayName = "DestinationEditor"

export { DestinationEditor }

const getDestinationData = (params: { id?: string; type?: string }): DestinationData =>
  destinationsStore.listIncludeHidden.find(dst => dst._id === params.id) ||
  ({
    _id: getUniqueAutoIncId(
      params.type,
      destinationsStore.listIncludeHidden.map(dst => dst._id)
    ),
    _uid: randomId(),
    _type: params.type,
    _mappings: { _keepUnmappedFields: true },
    _comment: null,
    _onlyKeys: [],
  } as DestinationData)
