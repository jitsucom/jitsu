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
  breadcrumbs: BreadcrumbElement[]
}

/**
 * This store allows components to modify page header.
 *
 * At the moment, it only stores the breadcrumbs at the top of the page
 */
class CurrentPageHeader implements ICurrentPageHeader {
  private _breadcrumbs: BreadcrumbElement[]

  constructor() {
    this._breadcrumbs = [{ link: "/", title: "Home" }]
    makeAutoObservable(this)
  }

  /**
   * Sets breadcrumbs. If first element doesn't point to project home, it will be added
   * automatically
   */
  set breadcrumbs(breadcrumbs: BreadcrumbElement[]) {
    this._breadcrumbs =
      breadcrumbs.length > 0 && breadcrumbs[0].link === "/"
        ? breadcrumbs
        : [{ link: "/", title: "Home" }, ...breadcrumbs]
  }

  get breadcrumbs(): BreadcrumbElement[] {
    return this._breadcrumbs
  }
}

export const currentPageHeaderStore: ICurrentPageHeader = new CurrentPageHeader()
