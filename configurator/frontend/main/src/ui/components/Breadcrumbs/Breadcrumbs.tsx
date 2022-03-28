import { NavLink } from "react-router-dom"
import { observer } from "mobx-react-lite"
import { currentPageHeaderStore } from "stores/currentPageHeader"
import ProjectLink from "lib/components/ProjectLink/ProjectLink"
import useProject from "hooks/useProject"
import { showProjectSwitchModal } from "lib/components/ProjectSwitch/ProjectSwitch"

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

function Delimiter() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

const BreadcrumbsComponent: React.FC<{}> = () => {
  const project = useProject()
  return (
    <div className="flex flex-row items-center text-base space-x-1">
      {project?.name && (
        <>
          <div
            key="main"
            className="hover:bg-bgSecondary px-3 py-1 rounded-lg text-heading cursor-pointer"
            onClick={showProjectSwitchModal}
          >
            {project.name}
          </div>
          <Delimiter key={"delim"} />
        </>
      )}
      {join(
        currentPageHeaderStore.breadcrumbs.map((element, index) => (
          <div className={`${element.link && "hover:bg-bgSecondary"} px-3 py-1 rounded-lg`} key={`element-${index}`}>
            {element.link ? (
              element.absolute || element.link.indexOf("/prj-") >= 0 ? (
                <NavLink className="text-heading hover:text-heading" to={element.link}>
                  {element.title}
                </NavLink>
              ) : (
                <ProjectLink to={element.link} className="text-heading hover:text-heading">
                  {element.title}
                </ProjectLink>
              )
            ) : (
              element.title
            )}
          </div>
        )),
        num => (
          <Delimiter key={"delim" + num} />
        )
      )}
    </div>
  )
}

export const Breadcrumbs = observer(BreadcrumbsComponent)
