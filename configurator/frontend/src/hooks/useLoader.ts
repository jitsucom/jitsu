import { DependencyList, Dispatch, SetStateAction, useEffect, useState } from "react"

export type Loader<T> = () => Promise<T>
export type Reloader = () => Promise<void>
type IsLoading = boolean

type LoaderResult<T> = [Error, T, Dispatch<SetStateAction<T>>, Reloader, IsLoading]

type LoaderResultObject<T> = {
  error: Error
  data: T
  setData: Dispatch<SetStateAction<T>>
  reloader: Reloader
  isLoading: IsLoading
}

/**
 * React hook for loading the data from remote component. Use it like this:
 * ```tsx
 * function TestComponent() {
 *   const [
 *    error,
 *    data,
 *    forceSetData,
 *    forceReloadData,
 *    isLoadingData
 *   ] = useLoader(async () => {
 *     return await getData();
 *   });
 *
 *   if (error) {
 *     return <ErrorComponent />
 *   } else if (!data) {
 *     return <LoadingComponent />
 *   }
 *   //main component render
 * }
 * ```
 * TODO: implement loader chaining e.g. useLoader(loader1, loader2)
 *
 *
 */
function useLoader<T>(loader: Loader<T>, deps?: DependencyList): LoaderResult<T> {
  const [data, setData] = useState(undefined)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState(undefined)
  const loaderWrapper = async () => {
    setError(null)
    setIsLoading(true)
    setData(null)
    try {
      setData(await loader())
    } catch (e) {
      setError(e)
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => {
    loaderWrapper()
  }, deps ?? [])
  return [error, data, setData, () => loaderWrapper(), isLoading]
}

/**
 * Same as asLoader, but returns an object instead of array
 */
function useLoaderAsObject<T>(loader: Loader<T>, deps?: DependencyList) {
  const [error, data, setData, reloader, isLoading] = useLoader(loader, deps)
  return { error, data, setData, reloader, isLoading }
}

export default useLoader
export { useLoader, useLoaderAsObject }
