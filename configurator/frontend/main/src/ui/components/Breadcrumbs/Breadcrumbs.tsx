import { createContext, ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { observer } from "mobx-react-lite"
import { currentPageHeaderStore } from "../../../stores/currentPageHeader"
import { useServices } from "../../../hooks/useServices"
import ProjectLink from "../../../lib/components/ProjectLink/ProjectLink"

function join<T>(array: T[], separatorFactory: (id: number) => T): T[] {
  let res = []
  for (let i = 0; i < array.length; i++) {
    res.push(array[i])
    if (i !== array.length - 1) {
      res.push(separatorFactory(i))
    }
  }
  return res
}

const BreadcrumbsComponent: React.FC<{}> = () => {
  return (
    <div className="flex flex-row items-center text-base space-x-3">
      {join(
        currentPageHeaderStore.breadcrumbs.map((element, index) => (
          <div className="" key={`element-${index}`}>
            {element.link ? (
              element.absolute ? (
                <NavLink to={element.link} />
              ) : (
                <ProjectLink to={element.link} className="text-heading">
                  {element.title}
                </ProjectLink>
              )
            ) : (
              element.title
            )}
          </div>
        )),
        num => (
          <div key={`sep-${num}`} className="text-heading">
            /
          </div>
        )
      )}
    </div>
  )
}

export const Breadcrumbs = observer(BreadcrumbsComponent)
