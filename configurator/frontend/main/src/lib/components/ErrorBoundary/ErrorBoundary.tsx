import ApplicationServices from "lib/services/ApplicationServices"
import { Component } from "react"
import { ErrorCard } from "../ErrorCard/ErrorCard"

type Props = {
  hideError?: boolean
  onAfterErrorOccured?: (error: Error) => void
}
type State = {
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props) {
    super(props)
    this.state = {}
  }

  static getDerivedStateFromError(e) {
    let error = e
    if (!(error instanceof Error)) error = new Error(`${error}`)

    return { error }
  }

  private toError(value: unknown | Error): Error {
    let error = value
    if (!(error instanceof Error)) error = new Error(`${error}`)
    return error as Error
  }

  componentDidCatch(err, info) {
    try {
      const error = this.toError(err)
      let services = ApplicationServices.get()
      services?.analyticsService?.onGlobalError?.(error)
      this.props.onAfterErrorOccured(error)
    } catch (e) {
      console.warn("Can't send error to monitoring", e)
    }
  }

  render() {
    if (this.state.error && this.props.hideError) return null

    if (this.state.error) {
      return (
        <div className="flex justify-center items-center w-full h-full">
          <div className="h-96 max-w-3xl px-16">
            <ErrorCard
              title={"Internal error occurred: " + this.state.error.message}
              onReload={() => this.setState({ error: null })}
              stackTrace={this.state.error.stack}
            />
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
