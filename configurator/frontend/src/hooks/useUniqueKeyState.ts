import { uniqueId } from "lodash"
import { useCallback, useState } from "react"

export const useUniqueKeyState = (idPrefix?: string): [string, () => void] => {
  const [state, setState] = useState(uniqueId(idPrefix))
  const handleGenerateNewState = useCallback<() => void>(() => {
    setState(uniqueId(idPrefix))
  }, [])
  return [state, handleGenerateNewState]
}
