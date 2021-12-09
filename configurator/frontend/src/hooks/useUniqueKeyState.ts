import { uniqueId } from "lodash"
import { useCallback, useState } from "react"

export const useUniqueKeyState = (): [string, () => void] => {
  const [state, setState] = useState(uniqueId())
  const handleGenerateNewState = useCallback<() => void>(() => {
    setState(uniqueId())
  }, [])
  return [state, handleGenerateNewState]
}
