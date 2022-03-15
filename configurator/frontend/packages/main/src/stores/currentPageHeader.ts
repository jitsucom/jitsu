import { makeAutoObservable, makeObservable } from "mobx"
import { ReactNode } from "react"

/**
 * Breadcrumb element
 */
export type BreadcrumbElement = {
  /**
   * Link. If not set, the element will not be highlighted
   */
  link?: string
  /**
   * If link is absolute. Otherwise, it's going to be relative to the project
   */
  absolute?: boolean
  /**
   * Link title
   */
  title: ReactNode
}

interface ICurrentPageHeader {
  setBreadcrumbs(...breadcrumbs: (BreadcrumbElement | string)[])

  getBreadcrumbs(): BreadcrumbElement[]
}

/**
 * This store allows components to modify page header.
 *
 * At the moment, it only stores the breadcrumbs at the top of the page
 */
class CurrentPageHeader implements ICurrentPageHeader {
  private _breadcrumbs: BreadcrumbElement[]

  constructor() {
    makeAutoObservable(this)
  }

  /**
   * Sets breadcrumbs. If first element doesn't point to project home, it will be added
   * automatically
   */
  setBreadcrumbs(...breadcrumbs: (BreadcrumbElement | string)[]) {
    console.log("Setting breadcrumbs", breadcrumbs)
    let normalized: BreadcrumbElement[] = breadcrumbs.map(b => (typeof b === "string" ? { title: b } : b))
    this._breadcrumbs =
      normalized.length > 0 && normalized[0].link === "/" ? normalized : [{ link: "/", title: "Home" }, ...normalized]
  }

  getBreadcrumbs(): BreadcrumbElement[] {
    if (!this._breadcrumbs || this._breadcrumbs.length == 0) {
      return [{ link: "/", title: "Home" }]
    }
    return this._breadcrumbs
  }
}

export const currentPageHeaderStore: ICurrentPageHeader = new CurrentPageHeader()
