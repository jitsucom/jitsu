import { SourceConnector } from "@jitsu/catalog/sources/types"
import ApplicationServices from "lib/services/ApplicationServices"
import { withQueryParams } from "utils/queryParams"
import { assert, assertIsArrayOfTypes, assertIsObject, assertIsString } from "utils/typeCheck"

export type PullAllStreams = (
  sourceDataFromCatalog: SourceConnector,
  handleBringSourceData: () => SourceData
) => Promise<StreamData[]>

export const PARSING_STREAMS_ERROR_NAME = "PARSING_STREAMS_ERROR"

export const pullAllAirbyteStreams = async (
  sourceDataFromCatalog: SourceConnector,
  handleBringSourceData: () => SourceData
): Promise<AirbyteStreamData[] | undefined> => {
  assert(
    sourceDataFromCatalog.protoType === "airbyte",
    "Attempted to pull airbyte streams but SourceConnector type is of a different type.",
    PARSING_STREAMS_ERROR_NAME
  )

  const services = ApplicationServices.get()

  const sourceData = await handleBringSourceData()
  const config = sourceData.config.config
  const image_version = sourceData.config.image_version
  const baseUrl = sourceDataFromCatalog.staticStreamsConfigEndpoint
  const project_id = services.userService.getUser().projects[0].id

  const response = await services.backendApiClient.post(
    withQueryParams(baseUrl, { project_id, image_version }),
    config,
    {
      proxy: true,
    }
  )

  if (response.message) throw new Error(response.message)

  if (response.status !== "pending") {
    /**
     * To do: extract all assertions blocks to separate functions
     */
    assertIsObject(response, `Airbyte streams parsing error: backend response is not an object`)
    assertIsObject(response.catalog, `Airbyte streams parsing error: backend response.catalog is not an object`)
    assertIsArrayOfTypes(
      response.catalog.streams,
      {},
      `Airbyte streams parsing error: backend response.catalog.streams is not an array of objects`,
      PARSING_STREAMS_ERROR_NAME
    )

    const rawAirbyteStreams: UnknownObject[] = response.catalog?.streams

    const streams: AirbyteStreamData[] = rawAirbyteStreams.map(stream => {
      assertIsString(
        stream.name,
        {
          errMsg: `Airbyte streams parsing error: stream.name is not a string`,
        },
        PARSING_STREAMS_ERROR_NAME
      )
      assertIsString(
        stream.namespace,
        {
          allowUndefined: true,
          errMsg: `Airbyte streams parsing error: stream.namespace is not a string or undefined`,
        },
        PARSING_STREAMS_ERROR_NAME
      )
      assertIsObject(
        stream.json_schema,
        `Airbyte streams parsing error: stream.json_schema is not an object`,
        PARSING_STREAMS_ERROR_NAME
      )
      if (stream.supported_sync_modes !== undefined) {
        assertIsArrayOfTypes(
          stream.supported_sync_modes,
          "",
          `Airbyte streams parsing error: stream.supported_sync_modes is not an array of strings or undefined`,
          PARSING_STREAMS_ERROR_NAME
        )
      }

      return {
        sync_mode: stream.supported_sync_modes[0],
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

export const pullAllSingerStreams = async (
  sourceDataFromCatalog?: SourceConnector,
  handleBringSourceData?: () => SourceData
): Promise<SingerStreamData[] | undefined> => {
  assert(
    sourceDataFromCatalog.protoType === "singer",
    "Attempted to pull singer streams but SourceConnector type is of a different type."
  )

  const services = ApplicationServices.get()
  const sourceData = await handleBringSourceData()
  const config = sourceData.config.config
  const project_id = services.userService.getUser().projects[0].id
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
    assertIsObject(
      response,
      `Singer streams parsing error: backend response is not an object`,
      PARSING_STREAMS_ERROR_NAME
    )
    assertIsObject(
      response.catalog,
      `Singer streams parsing error: backend response.catalog is not an object`,
      PARSING_STREAMS_ERROR_NAME
    )
    assertIsArrayOfTypes(
      response.catalog.streams,
      {},
      `Singer streams parsing error: backend response.catalog.streams is not an array of objects`,
      PARSING_STREAMS_ERROR_NAME
    )

    const rawSingerStreams: UnknownObject[] = response.catalog?.streams

    const streams: SingerStreamData[] = rawSingerStreams.map((stream: UnknownObject) => {
      assertIsString(
        stream.tap_stream_id,
        {
          errMsg: `Singer streams parsing error: stream.tap_stream_id is not a string`,
        },
        PARSING_STREAMS_ERROR_NAME
      )
      assertIsString(
        stream.stream,
        {
          errMsg: `Singer streams parsing error: stream.stream is not a string`,
        },
        PARSING_STREAMS_ERROR_NAME
      )
      assertIsArrayOfTypes(
        stream.key_properties,
        "",
        `Singer streams parsing error: stream.key_properties is not an array of strings`,
        PARSING_STREAMS_ERROR_NAME
      )
      assertIsObject(
        stream.schema,
        `Singer streams parsing error: stream.schema is not an object`,
        PARSING_STREAMS_ERROR_NAME
      )
      assertIsArrayOfTypes(
        stream.metadata,
        {},
        `Singer streams parsing error: stream.metadata is not an array of objects`,
        PARSING_STREAMS_ERROR_NAME
      )

      return {
        tap_stream_id: stream.tap_stream_id,
        stream: stream.stream,
        key_properties: stream.key_properties,
        schema: stream.schema,
        metadata: stream.metadata as {
          breadcrumb: string[]
          metadata: UnknownObject
        }[],
      }
    })

    return streams
  }
}
