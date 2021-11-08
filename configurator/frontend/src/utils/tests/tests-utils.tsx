import { FC, ReactElement } from "react"
import { BrowserRouter } from "react-router-dom"
import { render, RenderOptions } from "@testing-library/react"

const AllProviders: FC = ({ children }) => {
  return <BrowserRouter>{children}</BrowserRouter>
}

const renderWithAllProviders = (element: ReactElement, options?: Omit<RenderOptions, "queries">) =>
  render(element, { wrapper: AllProviders, ...options })

export * from "@testing-library/react"
export { render as bareRender } from "@testing-library/react"
export { renderWithAllProviders as render }
