import axios, { AxiosRequestConfig, AxiosResponse, AxiosTransformer, Method } from "axios"
import { cleanAuthorizationLocalStorage, concatenateURLs, reloadPage } from "lib/commons/utils"
import AnalyticsService from "./analytics"
import { ApiAccess, AS_IS_FORMAT, JSON_FORMAT } from "./model"

/**
 * Additional options for API request
 */
export type ApiRequestOptions = {
  /**
   * If request should be sent to /proxy endpoint
   */
  proxy?: boolean
  /**
   * Get parameters (to avoid adding them to URL for better readability)
   */
  urlParams?: { [propName: string]: any }
  /**
   * If set to true, Auth header should not be added
   */
  noauth?: boolean
  /**
   * API version, 1 by default
   */
  version?: number
}

const DEFAULT_OPTIONS: ApiRequestOptions = { version: 1 } as const

/**
 * Backend API client. Authorization is handled by implementation
 */
export interface BackendApiClient {
  /**
   * For end-points that return JSON. In that case response will
   * be deserialized
   * @param url url
   * @param payload payload
   * @param opts additional options
   */
  post<T = any>(url, payload: any, opts?: ApiRequestOptions): Promise<T>

  /**
   * Same as post, but returns raw body
   */
  postRaw(url, data: any, opts?: ApiRequestOptions): Promise<string>

  getRaw(url, opts?: ApiRequestOptions): Promise<string>

  get<T = any>(url: string, opts?: ApiRequestOptions): Promise<T>

  put<T = any>(url, payload: unknown, opts?: ApiRequestOptions): Promise<T>

  patch<T = any>(url, payload: unknown, opts?: ApiRequestOptions): Promise<T>

  delete(url, opts?: ApiRequestOptions): Promise<void>
}

export class APIError extends Error {
  private _httpStatus: number
  private _response: any

  constructor(response: AxiosResponse, request: AxiosRequestConfig) {
    super(getErrorMessage(response, request))
    this._httpStatus = response.status
    this._response = response.data
  }
}

function getErrorMessage(response: AxiosResponse, request: AxiosRequestConfig): string {
  let errorResponse = parseErrorResponseBody(response)
  if (errorResponse && errorResponse.message) {
    return `${errorResponse.message} (#${response.status})`
  } else {
    return `Error ${response.status} at ${request.url}`
  }
}

function parseErrorResponseBody(response: AxiosResponse) {
  let strResponse = response.data.toString()
  if (response.data === null || response.data === undefined) {
    return null
  }
  if (typeof response.data === "object") {
    return response.data
  }
  try {
    return response.data ? JSON.parse(response.data.toString()) : null
  } catch (e) {
    return null
  }
}

export class JWTBackendClient implements BackendApiClient {
  private readonly baseUrl: string
  private readonly proxyUrl: string
  private readonly apiAccessAccessor: () => ApiAccess
  private readonly analyticsService: AnalyticsService

  constructor(
    baseUrl: string,
    proxyUrl: string,
    apiAccessAccessor: () => ApiAccess,
    analyticsService: AnalyticsService
  ) {
    this.baseUrl = baseUrl
    this.proxyUrl = proxyUrl
    this.apiAccessAccessor = apiAccessAccessor
    this.analyticsService = analyticsService

    //Refresh token axios interceptor
    axios.interceptors.response.use(
      response => {
        return response
      },
      function (error) {
        const originalRequest = error.config

        //try to refresh only if 401 error + authorization supports refresh tokens
        if (
          error.response &&
          error.response.status === 401 &&
          apiAccessAccessor().supportRefreshToken() &&
          !originalRequest._retry &&
          !originalRequest.url.includes("/v1/users/token/refresh")
        ) {
          originalRequest._retry = true
          return axios
            .post(concatenateURLs(baseUrl, "/v1/users/token/refresh"), {
              refresh_token: apiAccessAccessor().refreshToken,
            })
            .then(res => {
              if (res.status === 200) {
                apiAccessAccessor().updateTokens(res.data["access_token"], res.data["refresh_token"])
                originalRequest.headers = {
                  "X-Client-Auth": apiAccessAccessor().accessToken,
                }
                return axios(originalRequest)
              }
            })
        }

        return Promise.reject(error)
      }
    )
  }

  private exec(
    method: Method,
    transform: AxiosTransformer,
    url: string,
    payload: unknown,
    options: ApiRequestOptions = { version: 1 }
  ): Promise<any> {
    const opts = { ...DEFAULT_OPTIONS, ...(options ?? {}) }
    const baseUrl = opts.proxy ? this.proxyUrl : this.baseUrl
    const baseUrlWithApiVersion = concatenateURLs(baseUrl, `/v${opts.version}/`)
    let fullUrl = concatenateURLs(baseUrlWithApiVersion, url)
    if (opts.urlParams) {
      fullUrl +=
        "?" +
        Object.entries(opts.urlParams)
          .filter(([, val]) => val !== undefined)
          .map(([key, val]) => `${key}=${encodeURIComponent(val + "")}`)
          .join("&")
    }

    const request: AxiosRequestConfig = {
      method: method,
      url: fullUrl,
      transformResponse: transform,
    }

    if (!opts.noauth) {
      request.headers = {
        "X-Client-Auth": this.apiAccessAccessor().accessToken,
      }
    }

    if (payload !== undefined) {
      if (method.toLowerCase() === "get") {
        throw new Error(`System UI Error: GET ${fullUrl} can't have a body`)
      }
      request.data = payload
    }
    return new Promise<any>((resolve, reject) => {
      axios(request)
        .then((response: AxiosResponse<any>) => {
          if (response.status == 200 || response.status == 201) {
            resolve(response.data)
          } else if (response.status == 204) {
            resolve({})
          } else {
            let error = new APIError(response, request)
            this.handleApiError(request, response)
            reject(error)
          }
        })
        .catch(error => {
          if (error.response) {
            this.handleApiError(request, error.response)
            reject(new APIError(error.response, request))
          } else {
            let baseMessage = "Request at " + fullUrl + " failed"
            if (error.message) {
              baseMessage += " with " + error.message
            }
            this.analyticsService.onFailedAPI({
              method: request.method,
              url: request.url,
              requestPayload: request.data,
              responseStatus: -1,
              errorMessage: baseMessage,
            })
            reject(error)
            reject(new Error(baseMessage))
          }
        })
    })
  }

  private handleApiError(request: AxiosRequestConfig, response: AxiosResponse<any>) {
    this.analyticsService.onFailedAPI({
      method: request.method,
      url: request.url,
      requestPayload: request.data,
      responseStatus: response.status,
      responseObject: response.data,
    })

    //we should remove authorization and reload page
    if (response.status == 401) {
      cleanAuthorizationLocalStorage()
      reloadPage()
    }
  }

  get(url: string, opts?: ApiRequestOptions): Promise<any> {
    return this.exec("get", JSON_FORMAT, url, undefined, opts)
  }

  post(url: string, data: any, opts?: ApiRequestOptions): Promise<any> {
    return this.exec("post", JSON_FORMAT, url, data, opts)
  }

  put(url: string, data: unknown, opts?: ApiRequestOptions): Promise<any> {
    return this.exec("put", JSON_FORMAT, url, data, opts)
  }

  patch(url: string, data: unknown, opts?: ApiRequestOptions): Promise<any> {
    return this.exec("PATCH", JSON_FORMAT, url, data, opts)
  }

  delete(url: string, opts?: ApiRequestOptions): Promise<any> {
    return this.exec("delete", JSON_FORMAT, url, undefined, opts)
  }

  postRaw(url, data: unknown, opts?: ApiRequestOptions): Promise<string> {
    return this.exec("post", AS_IS_FORMAT, url, data ?? {}, opts)
  }

  getRaw(url, opts?: ApiRequestOptions): Promise<string> {
    return this.exec("get", AS_IS_FORMAT, url, undefined, opts)
  }
}
