import { useCallback, useEffect, useReducer } from "react"

type SourceEditorViewState = {
  loaders: {
    isLoadingConfig: boolean
    isLoadingStreams: boolean
    isTestingConnection: boolean
    isLoadingOauthStatus: boolean
  }
}

const initialState: SourceEditorViewState = {
  loaders: {
    isLoadingConfig: false,
    isLoadingStreams: false,
    isTestingConnection: false,
    isLoadingOauthStatus: false,
  },
}

/**
 * Available source editor actions types
 */
enum SourceEditorActionsTypes {
  SET_LOADERS_STATE,
}

/**
 * Map of factories of source editor actions
 */
const actionsFactories = {
  [SourceEditorActionsTypes.SET_LOADERS_STATE](payload: { loaders: Partial<SourceEditorViewState["loaders"]> }) {
    return { type: SourceEditorActionsTypes.SET_LOADERS_STATE, payload } as const
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
    case SourceEditorActionsTypes.SET_LOADERS_STATE:
      return { ...state, loaders: { ...state.loaders, ...action.payload } }
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
 * Custom hook that returns current state and a function for dispatching actions that update the state
 */
export const useSourceEditorState = (): [SourceEditorViewState, Dispatcher] => {
  const [state, dispatch] = useReducer<Reducer>(reducer, initialState)

  const dispatchAction = useCallback<Dispatcher>((type, payload) => {
    dispatch(actionsFactories[type](payload as any))
  }, [])

  return [state, dispatchAction]
}

const MockEditor = () => {
  const [state, dispatchAction] = useSourceEditorState()

  useEffect(() => {
    dispatchAction(SourceEditorActionsTypes.SET_LOADERS_STATE, {
      loaders: {
        isLoadingConfig: true,
      },
    })
  })

  return null
}
