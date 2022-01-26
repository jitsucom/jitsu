import { Dispatch, SetStateAction, useState } from "react"

/**
 * Same as useState, but persist state in local storage
 */
export function usePersistentState<S>(initialState: S | (() => S), localKey: string): [S, Dispatch<SetStateAction<S>>] {
  const local = localStorage.getItem(localKey)
  const [state, setState] = useState(local === null ? initialState : JSON.parse(local))
  return [
    state,
    newState => {
      localStorage.setItem(localKey, JSON.stringify(newState))
      setState(newState)
    },
  ]
}
