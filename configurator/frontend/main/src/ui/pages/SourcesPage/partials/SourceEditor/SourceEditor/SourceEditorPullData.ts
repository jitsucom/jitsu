import { SourceConnector } from "@jitsu/catalog/sources/types"
import ApplicationServices from "lib/services/ApplicationServices"
import { withQueryParams } from "utils/queryParams"
import { assert, assertIsArrayOfTypes, assertIsBoolean, assertIsObject, assertIsString } from "utils/typeCheck"
import { sourceEditorUtils } from "./SourceEditor.utils"

export type PullAllStreams = (
  sourceDataFromCatalog: SourceConnector,
  handleBringSourceData: () => SourceData
) => Promise<StreamData[]>

export const PARSING_STREAMS_ERROR_NAME = "PARSING_STREAMS_ERROR"

export const pullAllAirbyteStreams = async (
  sourceDataFromCatalog: SourceConnector,
  handleBringSourceData: () => AirbyteSourceData
): Promise<AirbyteStreamData[] | undefined> => {
  assert(
    sourceDataFromCatalog.protoType === "airbyte",
    `Attempted to pull airbyte streams but SourceConnector type is of a different type (${sourceDataFromCatalog.protoType})`,
    PARSING_STREAMS_ERROR_NAME
  )

  const services = ApplicationServices.get()

  const sourceData = await handleBringSourceData()
  const config = sourceData.config.config
  const image_version = sourceData.config.image_version
  const baseUrl = sourceDataFromCatalog.staticStreamsConfigEndpoint
  const project_id = services.activeProject.id
  const previously_selected_streams = sourceData.config.selected_streams

  const response = await services.backendApiClient.post(
    withQueryParams(baseUrl, { project_id, image_version }),
    config,
    {
      proxy: true,
    }
  )

  if (response.message) throw new Error(response.message)

  if (response.status !== "pending") {
    assertHasCatalog(response, `Airbyte catalog parsing error`)
    const rawAirbyteStreams: UnknownObject[] = response.catalog?.streams
    const streams: AirbyteStreamData[] = rawAirbyteStreams.map((stream, idx) => {
      assertIsAirbyteCatalogStream(stream, `Failed to parse Airbyte stream ${stream} with index ${idx}`)
      const streamMinimalConfig = { name: stream.name, namespace: stream.namespace }
      const previouslySelectedStream = previously_selected_streams?.find(previouslySelectedStreamConfig =>
        sourceEditorUtils.streamsAreEqual(previouslySelectedStreamConfig, streamMinimalConfig)
      )
      return {
        sync_mode: previouslySelectedStream?.sync_mode ?? stream.supported_sync_modes[0],
        cursor_field: previouslySelectedStream?.cursor_field ?? undefined,
        destination_sync_mode: "overwrite",
        stream: {
          name: stream.name,
          namespace: stream.namespace,
          json_schema: stream.json_schema,
          supported_sync_modes: stream.supported_sync_modes,
          ...stream,
        },
      }
    })

    return streams
  }
}

export const pullAllSDKSourceStreams = async (
  sourceDataFromCatalog: SourceConnector,
  handleBringSourceData: () => SourceData
): Promise<SDKSourceStreamData[] | undefined> => {
  assert(
    sourceDataFromCatalog.protoType === "sdk_source",
    `Attempted to pull sdk_source streams but SourceConnector type is of a different type (${sourceDataFromCatalog.protoType})`,
    PARSING_STREAMS_ERROR_NAME
  )

  const services = ApplicationServices.get()

  const sourceData = await handleBringSourceData()
  const config = sourceData.config
  const baseUrl = sourceDataFromCatalog.staticStreamsConfigEndpoint
  const project_id = services.activeProject.id

  const response = await services.backendApiClient.post(withQueryParams(baseUrl, { project_id }), config, {
    proxy: true,
  })

  if (response.message) throw new Error(response.message)

  if (response.status !== "pending") {
    assertSDKSourceCatalog(response, `SDK Source catalog parsing error`)
    const streams: SDKSourceStreamData[] = response.catalog.map((stream, idx) => {
      assertIsSDKSourceCatalogStream(stream, `Failed to parse SDK Source stream ${stream} with index ${idx}`)
      return stream
    })
    return streams
  }
}

export const pullAllSingerStreams = async (
  sourceDataFromCatalog?: SourceConnector,
  handleBringSourceData?: () => SingerSourceData
): Promise<SingerStreamData[] | undefined> => {
  assert(
    sourceDataFromCatalog.protoType === "singer",
    "Attempted to pull singer streams but SourceConnector type is of a different type."
  )

  const services = ApplicationServices.get()
  const sourceData = await handleBringSourceData()
  const config = sourceData.config.config
  const project_id = services.activeProject.id
  const tap = sourceDataFromCatalog.id.replace("singer-", "")
  const baseUrl = `/singer/${tap}/catalog`

  const response = await services.backendApiClient.post(
    withQueryParams(baseUrl, { project_id, source_id: project_id + "." + sourceData.sourceId }),
    config,
    {
      proxy: true,
    }
  )

  if (response.message) throw new Error(response.message)

  if (response.status !== "pending") {
    assertHasCatalog(response, `Singer catalog parsing error`)
    const rawSingerStreams: UnknownObject[] = response.catalog?.streams
    const streams: SingerStreamData[] = rawSingerStreams.map((stream, idx) => {
      assertIsSingerCatalogStream(stream, `Failed to parse Singer stream ${stream} with index ${idx}`)
      return stream
    })
    return streams
  }
}

function assertSDKSourceCatalog(response: unknown, errorMessage): asserts response is { catalog: UnknownObject[] } {
  assertIsObject(response, `${errorMessage}: Backend response is not an object`)
  assertIsObject(response.catalog, `${errorMessage}: Backend response.catalog is not an object`)
  assertIsArrayOfTypes<UnknownObject>(
    response.catalog,
    {},
    `${errorMessage}: Backend response.catalog is not an array of objects`,
    PARSING_STREAMS_ERROR_NAME
  )
}

function assertHasCatalog(
  response: unknown,
  errorMessage
): asserts response is { catalog: { streams: UnknownObject[] } } {
  assertIsObject(response, `${errorMessage}: Backend response is not an object`)
  assertIsObject(response.catalog, `${errorMessage}: Backend response.catalog is not an object`)
  assertIsArrayOfTypes<UnknownObject>(
    response.catalog.streams,
    {},
    `${errorMessage}: Backend response.catalog.streams is not an array of objects`,
    PARSING_STREAMS_ERROR_NAME
  )
}

function assertIsAirbyteCatalogStream(
  stream: UnknownObject,
  errorMessage
): asserts stream is AirbyteStreamData["stream"] {
  assertIsString(
    stream.name,
    {
      errMsg: `${errorMessage}: stream.name is not a string`,
    },
    PARSING_STREAMS_ERROR_NAME
  )
  assertIsString(
    stream.namespace,
    {
      allowUndefined: true,
      errMsg: `${errorMessage}: stream.namespace is not a string or undefined`,
    },
    PARSING_STREAMS_ERROR_NAME
  )
  assertIsObject(stream.json_schema, `${errorMessage}: stream.json_schema is not an object`, PARSING_STREAMS_ERROR_NAME)
  if (stream.supported_sync_modes !== undefined) {
    assertIsArrayOfTypes(
      stream.supported_sync_modes,
      "",
      `${errorMessage}: stream.supported_sync_modes is not an array of strings or undefined`,
      PARSING_STREAMS_ERROR_NAME
    )
  }
}

function assertIsSDKSourceCatalogStream(
  collection: UnknownObject,
  errorMessage
): asserts collection is SDKSourceStreamData {
  assertIsString(
    collection.type,
    {
      errMsg: `${errorMessage}: collection.type is not a string`,
    },
    PARSING_STREAMS_ERROR_NAME
  )
  if (collection.supportedModes !== undefined) {
    assertIsArrayOfTypes(
      collection.supportedModes,
      "",
      `${errorMessage}: collection.supportedModes is not an array of strings or undefined`,
      PARSING_STREAMS_ERROR_NAME
    )
  }
}

function assertIsSingerCatalogStream(stream: UnknownObject, errorMessage): asserts stream is SingerStreamData {
  assertIsString(
    stream.tap_stream_id,
    {
      errMsg: `${errorMessage}: stream.tap_stream_id is not a string`,
    },
    PARSING_STREAMS_ERROR_NAME
  )
  assertIsString(
    stream.stream,
    {
      errMsg: `${errorMessage}: stream.stream is not a string`,
    },
    PARSING_STREAMS_ERROR_NAME
  )
  assertIsArrayOfTypes(
    stream.key_properties,
    "",
    `${errorMessage}: stream.key_properties is not an array of strings`,
    PARSING_STREAMS_ERROR_NAME
  )
  assertIsObject(stream.schema, `${errorMessage}: stream.schema is not an object`, PARSING_STREAMS_ERROR_NAME)
  assertIsArrayOfTypes<UnknownObject>(
    stream.metadata,
    {},
    `${errorMessage}: stream.metadata is not an array of objects`,
    PARSING_STREAMS_ERROR_NAME
  )

  stream.metadata.forEach((metadataObject, idx) => {
    assertIsArrayOfTypes(
      metadataObject.breadcrumb,
      "",
      `${errorMessage}: in stream with name ${stream.name}: breadcrumb property of stream.metadata array member with index ${idx} is not an array of strings`
    )
    assertIsObject(
      metadataObject.metadata,
      "",
      `${errorMessage}: in stream with name ${stream.name}: metadata property of stream.metadata array member with index ${idx} is not an object`
    )
  })
}
