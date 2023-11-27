// @Libs
import { rest } from "msw"
import { setupServer, SetupServerApi } from "msw/node"
// @Mock Responses
import {
  mockApiKeys,
  mockConfiguration,
  mockDestinationsList,
  mockDestinationTest,
  mockSources,
  mockStatistics,
  mockUserInfo,
} from "./tests-utils.mock-responses"

type MockEndpointConfig = {
  responseData: { [key: string]: unknown }
  requestFactory: (responseData: { [key: string]: unknown }) => ReturnType<typeof rest[keyof typeof rest]>
}

type MockServerConfig = {
  readonly [key: string]: MockEndpointConfig
}

/**
 *  Endpoints that are required to initialize the application
 */
const mockObligatoryEndpoints = {
  configuration: {
    responseData: mockConfiguration,
    requestFactory: (mockData: unknown) =>
      rest.get("*/system/configuration", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  userInfo: {
    responseData: mockUserInfo,
    requestFactory: (mockData: unknown) =>
      rest.get(`*/users/info*`, (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  statistics: {
    responseData: mockStatistics,
    requestFactory: (mockData: unknown) =>
      rest.get("*/statistics*", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  onboarded: {
    responseData: { completed: true },
    requestFactory: (mockData: unknown) =>
      rest.get("*/configurations/onboarding_tour_completed*", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  api_keys: {
    responseData: mockApiKeys,
    requestFactory: mockData =>
      rest.get("*/api_keys*", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  destinations_get: {
    responseData: mockDestinationsList,
    requestFactory: mockData =>
      rest.get("*/destinations", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  sources_get: {
    responseData: mockSources,
    requestFactory: mockData =>
      rest.get("*/configurations/sources*", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
} as const

/**
 * Other endpoints
 */
const mockEndpointsCatalog = {
  destination_test: {
    responseData: mockDestinationTest,
    requestFactory: mockData =>
      rest.post("*/destinations/test", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  destinations_post: {
    responseData: {
      status: "ok",
    },
    requestFactory: mockData =>
      rest.post("*/destinations", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
  sources_post: {
    responseData: {
      status: "ok",
    },
    requestFactory: mockData =>
      rest.post("*/configurations/sources*", (req, res, ctx) => {
        return res(ctx.json(mockData))
      }),
  },
} as const

/**
 * Mock server setup
 */

/**
 * Sets up the mock server with some default endpoints that are required globally
 * along with the endpoints provided by user. User endpoints will override the defaults
 * if their keys match.
 *
 * @param endpoints
 * Endpoints to use for the mock server.
 *
 * Use `setupMockServer.endpoints.catalog` to get some handy defaults.
 *
 * To override one of the required endpoints just copy it from
 * `setupMockServer.endpoints.required`, change the data or the implementation
 * and pass it in `endpoints` under the same key as it appears in the
 * `setupMockServer.endpoints.required` catalog.
 *
 * @returns configured mock server instance.
 */
export function setupMockServer(endpoints: MockServerConfig = {}): SetupServerApi {
  const _endpoints: MockServerConfig = {
    ...mockObligatoryEndpoints,
    ...mockEndpointsCatalog,
    ...endpoints,
  }
  const _endpointsList = Object.values(_endpoints).map(({ responseData, requestFactory }) =>
    requestFactory(responseData)
  )
  return setupServer(..._endpointsList)
}

const defaultEndpoints = {
  required: mockObligatoryEndpoints,
  catalog: mockEndpointsCatalog,
} as const

setupMockServer.endpoints = defaultEndpoints
