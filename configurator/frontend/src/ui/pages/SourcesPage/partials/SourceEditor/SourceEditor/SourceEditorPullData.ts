import { SourceConnector } from "catalog/sources/types"
import ApplicationServices from "lib/services/ApplicationServices"
import { withQueryParams } from "utils/queryParams"
import { assertIsArrayOfTypes, assertIsObject, assertIsString } from "utils/typeCheck"

export const pullAllAirbyteStreams = async (
  previouslyCheckedStreams: AirbyteStreamData[],
  sourceDataFromCatalog: SourceConnector,
  handleBringSourceData: () => SourceData
): Promise<AirbyteStreamData[] | undefined> => {
  const services = ApplicationServices.get()

  const config = (await handleBringSourceData()).config.config
  const baseUrl = sourceDataFromCatalog.staticStreamsConfigEndpoint
  const project_id = services.userService.getUser().projects[0].id

  const response = await services.backendApiClient.post(withQueryParams(baseUrl, { project_id }), config, {
    proxy: true,
  })

  if (response.message) throw new Error(response.message)

  if (response.status !== "pending") {
    assertIsObject(response, `Airbyte streams parsing error: backend response is not an object`)
    assertIsObject(response.catalog, `Airbyte streams parsing error: backend response.catalog is not an object`)
    assertIsArrayOfTypes(
      response.catalog.streams,
      {},
      `Airbyte streams parsing error: backend response.catalog.streams is not an array of objects`
    )

    const rawAirbyteStreams: UnknownObject[] = response.catalog?.streams

    const streams: AirbyteStreamData[] = rawAirbyteStreams.map(stream => {
      assertIsString(stream.name, {
        errMsg: `Airbyte streams parsing error: stream.name is not a string`,
      })
      assertIsString(stream.namespace, {
        allowUndefined: true,
        errMsg: `Airbyte streams parsing error: stream.namespace is not a string or undefined`,
      })
      assertIsObject(stream.json_schema, `Airbyte streams parsing error: stream.json_schema is not an object`)
      assertIsArrayOfTypes(
        stream.supported_sync_modes,
        "",
        `Airbyte streams parsing error: stream.supported_sync_modes is not an array of strings`
      )

      const previouslyCheckedStreamData = previouslyCheckedStreams.find(
        checkedStream =>
          checkedStream.stream.name === stream.name && checkedStream.stream.namespace === stream.namespace
      )

      if (previouslyCheckedStreamData) return previouslyCheckedStreamData

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
