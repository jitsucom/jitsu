import ApplicationServices from "lib/services/ApplicationServices"
import { Component } from "react"
import { ErrorCard } from "../ErrorCard/ErrorCard"

type Props = {}
type State = {
  error?: Error
}

const services = ApplicationServices.get()
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
    // logErrorToMyService(error, info);
    const error = this.toError(err)
    services.analyticsService.onGlobalError(error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex justify-center items-center w-full h-full">
          <div className="h-96 max-w-3xl px-16">
            <ErrorCard title="Internal error occured" onReload={() => this.setState({ error: null })} />
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
