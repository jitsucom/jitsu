/**
 * This code organizes the state of the Source Editor using the useReducer and Context
 *
 * For now it is only used to manage the View State, e.g. loaders and disabled elements
 * TO DO: Move the source editor state from useState hook here
 *
 * Use it is as follows
 *
 * @example
 * const SourceEditor = () => {
 *  return (
 *    <SourceEditorStateProvider> // wrap children in context provider so that they may consume state and dispatcher
 *      <SourceEditorChildComponent />
 *    </SourceEditorStateProvider>
 *  )
 * }
 *
 * const SourceEditorChildComponent = () => {
 *   const sourceEditorState = useSourceEditorState() // get source editor state from the context (warning: consuming state may result in a large amount of redundant re-renders)
 *   const dispatchAction = useSourceEditorDispatcher() // get source editor dispatcher for updating the state
 *
 *   useEffect(() => {
 *     dispatchAction(SourceEditorActionsTypes.SET_STATUS, {  // use dispathcer to update the state
 *       loaders: {
 *         isLoadingConfig: true,
 *         isLoadingStreams: false,
 *       },
 *     })
 *   }, [])
 *
 *   return sourceEditorState.loaders.isLoadingConfig ? "loading..." : "loaded!"
 * }
 *
 */

import React, { useCallback, useContext, useEffect, useReducer } from "react"

type SourceEditorViewState = {
  status: {
    isLoadingConfig: boolean
    isLoadingStreams: boolean
    isTestingConnection: boolean
    isLoadingOauthStatus: boolean
    isOauthFlowCompleted: boolean
  }
}

const initialState: SourceEditorViewState = {
  status: {
    isLoadingConfig: false,
    isLoadingStreams: false,
    isTestingConnection: false,
    isLoadingOauthStatus: false,
    isOauthFlowCompleted: false,
  },
}

/**
 * Available source editor actions types
 */
export enum SourceEditorActionsTypes {
  SET_STATUS,
}

/**
 * Map of factories of source editor actions
 */
const actionsFactories = {
  [SourceEditorActionsTypes.SET_STATUS](payload: Partial<SourceEditorViewState["status"]>) {
    return { type: SourceEditorActionsTypes.SET_STATUS, payload } as const
  },
} as const

/** Holds a union of all possible Source Editor actions */
type SourceEditorActionsObjects = ReturnType<typeof actionsFactories[keyof typeof actionsFactories]>

/** Returns type of action payload by action type */
type SourceEditorActionPayload<ActionType extends SourceEditorActionsTypes> = ReturnType<
  typeof actionsFactories[ActionType]
>["payload"]

/** Alias for reducer type */
type Reducer = (state: SourceEditorViewState, action: SourceEditorActionsObjects) => SourceEditorViewState

/** Reducer that handles incoming actions by mapping them to a new state */
const reducer: Reducer = (state, action) => {
  switch (action.type) {
    case SourceEditorActionsTypes.SET_STATUS:
      return { ...state, status: { ...state.status, ...action.payload } }
    default:
      console.warn(
        `Reducer in Source Editor did not apply any state updates for action ${action.type}.\nYou may have forgotten to specify an appropriate reducer case for this action.`
      )
      return state
  }
}

/** Helper for conviniently dispatching actions like `dispatchAction(type, payload) */
type Dispatcher = <T extends SourceEditorActionsTypes>(type: T, payload: SourceEditorActionPayload<T>) => void

/**
 * Context that provides source editor state to children components
 */
const SourceEditorStateContext = React.createContext<SourceEditorViewState>(initialState)

/**
 * Context that provides source editor actions dispatcher to children components
 */
const SourceEditorDispatchContext = React.createContext<Dispatcher>(() => {
  throw new Error(
    `SourceEditorDispatchContext value that was not initialized. This may indicate a missuse when no value was provided to SourceEditorDispatchContext.Provider.`
  )
})

/**
 * Helper wrapper component that provides source editor state and dispatchers via context
 */
export const SourceEditorStateProvider: React.FC = ({ children }) => {
  const [state, dispatch] = useReducer<Reducer>(reducer, initialState)

  const dispatcher = useCallback<Dispatcher>((type, payload) => {
    dispatch(actionsFactories[type](payload as any))
  }, [])

  return (
    <SourceEditorStateContext.Provider value={state}>
      <SourceEditorDispatchContext.Provider value={dispatcher}>{children}</SourceEditorDispatchContext.Provider>
    </SourceEditorStateContext.Provider>
  )
}

/**
 * Hook for getting source editor state in children components
 *
 * @warning
 * This state will be changing a lot causing consumers to re-render on every change.
 * Therefore, this hook is designed for use in top-most components of the SourceEditor.
 */
export const useSourceEditorState = (): SourceEditorViewState => {
  const state = useContext<SourceEditorViewState>(SourceEditorStateContext)
  if (!state) {
    throw new Error(`Attempted to get source editor state outside the SourceEditorStateContext.Provider.`)
  }
  return state
}

/**
 * Hook for getting source editor dispatcher in children components
 */
export const useSourceEditorDispatcher = (): Dispatcher => {
  const dispatcher = useContext<Dispatcher>(SourceEditorDispatchContext)
  if (!dispatcher) {
    throw new Error(`Attempted to get source editor dispatcher outside the SourceEditorDispatcherContext.Provider.`)
  }
  return dispatcher
}