import { makeAutoObservable } from "mobx"
import { ReactNode } from "react"
import { cloneDeep } from "lodash"

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
  /** the list of breadcrumbs to render */
  breadcrumbs: BreadcrumbElement[]
  /**
   * Sets breadcrumbs. If first element doesn't point to project home, it will be added
   * automatically
   */
  setBreadcrumbs(...breadcrumbs: (BreadcrumbElement | string)[])
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

  get breadcrumbs(): BreadcrumbElement[] {
    if (!this._breadcrumbs || this._breadcrumbs.length == 0) {
      return [{ link: "/", title: "Home" }]
    }
    /**
     * Deep copying `title` JSX Element object in order to prevent React from freezing it in
     * store on render. Otherwise, MobX _might_ occasionally throw `Dynamic observable objects
     * cannot be frozen`
     */
    return this._breadcrumbs.map(element => ({ ...element, title: cloneDeep(element.title) }))
  }

  setBreadcrumbs(...breadcrumbs: (BreadcrumbElement | string)[]) {
    console.log("Setting breadcrumbs", breadcrumbs)
    let normalized: BreadcrumbElement[] = breadcrumbs.map(b => (typeof b === "string" ? { title: b } : b))
    this._breadcrumbs =
      normalized.length > 0 && normalized[0].link === "/" ? normalized : [{ link: "/", title: "Home" }, ...normalized]
  }
}

export const currentPageHeaderStore: ICurrentPageHeader = new CurrentPageHeader()
