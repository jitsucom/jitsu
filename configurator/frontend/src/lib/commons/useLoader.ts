import { Dispatch, SetStateAction, useEffect, useState } from "react";

export type Loader<T> = () => Promise<T>;

/**
 * React hook for loading the data from remote component. Use it like this:
 * ```tsx
 * function TestComponent() {
 *   const [error, data] = useLoader(async () => {
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
function useLoader<T>(loader: Loader<T>): [Error, T, Dispatch<SetStateAction<T>>] {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(undefined);
  const loaderWrapper = async() => {
    try {
      setData(await loader())
    } catch (e) {
      setError(e)
    }
  }
  useEffect(() => {
    loaderWrapper();
  }, [])
  return [error, data, setData];
}


export default useLoader;
export { useLoader };