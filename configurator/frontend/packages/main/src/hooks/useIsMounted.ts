import { useEffect, useRef } from "react"

export const useIsMounted = (): (() => boolean) => {
  const isMountedRef = useRef(true)
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])
  return () => isMountedRef.current
}
