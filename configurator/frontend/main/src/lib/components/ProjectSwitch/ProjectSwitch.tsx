// @Libs
import React, { useCallback, useState } from "react"
import { Input, Modal } from "antd"
import { debounce } from "lodash"
// @Components
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { CenteredSpin } from "lib/components/components"
import { ErrorCard } from "lib/components/ErrorCard/ErrorCard"
// @Icons
import PlusOutlined from "@ant-design/icons/PlusOutlined"
import CheckOutlined from "@ant-design/icons/CheckOutlined"
// @Hooks
import useProject from "hooks/useProject"
import { useServices } from "hooks/useServices"
import { useLoaderAsObject } from "hooks/useLoader"
// @Types
import type { Project } from "generated/conf-openapi"
import { BilledButton } from "../BilledButton/BilledButton"
import { useVirtual } from "react-virtual"

export type ProjectSwitchProps = {
  onAfterProjectSelected: (project: Project, activeProject: Project) => void
  onNewProject: () => void
}

function getRenderedProjects(projects: Project[]) {
  return projects
}

export function showProjectSwitchModal() {
  let modal = Modal.info({
    title: null,
    icon: null,
    okText: "Close",
    content: (
      <ProjectSwitch
        onAfterProjectSelected={(project, activeProject) => {
          if (project.id === activeProject.id) {
            modal.destroy()
          }
        }}
        onNewProject={() => {
          modal.destroy()
        }}
      />
    ),
  })
}

const ProjectSwitch: React.FC<ProjectSwitchProps> = () => {
  const services = useServices()
  const activeProject = useProject()

  const { isLoading, error, data: projects } = useLoaderAsObject(services.projectService.getAvailableProjects, [])

  const onCreateNewProject = useCallback<() => Promise<void>>(async () => {
    try {
      const name = window.prompt("Name of the project:")
      const project = await services.projectService.createProject(name)
      window.location.assign(window.location.pathname.replace(activeProject.id, project.id))
    } catch (error) {
      actionNotification.error(`Failed to create a new project.\n${error}`)
    }
  }, [])

  const onProjectSelected = useCallback<(project: Project) => void>(
    project => {
      try {
        if (activeProject.id === project.id) return
        window.location.assign(window.location.pathname.replace(activeProject.id, project.id))
      } catch (error) {
        actionNotification.error(`Failed to switch project.\n${error}`)
      }
    },
    [activeProject]
  )

  return (
    <div>
      <div className="flex flex-row justify-between">
        <div className="text-xl">Select project</div>
        <div>
          <BilledButton
            plansBlacklist={["free"]}
            type="default"
            icon={<PlusOutlined />}
            onClick={onCreateNewProject}
            disabled={false}
          >
            New Project
          </BilledButton>
        </div>
      </div>
      <div className="py-6">
        <ProjectList
          projects={projects}
          activeProjectId={activeProject.id}
          loading={isLoading}
          error={error}
          onProjectSelected={onProjectSelected}
        />
      </div>
    </div>
  )
}

type ProjectListProps = {
  projects: Project[]
  activeProjectId: string
  loading?: boolean
  error?: Error
  onProjectSelected(project: Project): Promise<void> | void
}

const ProjectList: React.FC<ProjectListProps> = ({ projects, activeProjectId, loading, error, onProjectSelected }) => {
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([])

  React.useEffect(() => {
    setFilteredProjects(sortProjects(projects || []))
  }, [projects])

  const sortProjects = (projects: Project[]): Project[] => {
    return projects.sort((a, b) => (a.id === activeProjectId ? -1 : b.id == activeProjectId ? 1 : 0))
  }

  const handleSearchChange = debounce(e => {
    const term = e.target.value
    const filteredProjects = projects.filter(
      project =>
        !term ||
        term.trim() === "" ||
        project.name.toLowerCase().indexOf(term.toLowerCase()) >= 0 ||
        project.id.toLowerCase().indexOf(term.toLowerCase()) >= 0
    )
    setFilteredProjects(sortProjects(filteredProjects))
  }, 500)

  if (loading) {
    return <CenteredSpin />
  } else if (error) {
    return <ErrorCard title={`Error getting projects`} error={error} />
  } else if (!projects) {
    return <ErrorCard title={`Projects are empty`} />
  }

  return (
    <>
      {getRenderedProjects(projects).length >= 5 && (
        <div className="mb-6">
          <Input autoFocus onChange={handleSearchChange} placeholder="Search" />
        </div>
      )}
      <VirtualList
        projects={filteredProjects || []}
        activeProjectId={activeProjectId}
        onProjectSelected={onProjectSelected}
      />
    </>
  )
}

const VirtualList: React.FC<{
  projects: Project[]
  activeProjectId: string
  onProjectSelected(project: Project): Promise<void> | void
}> = ({ projects, activeProjectId, onProjectSelected }) => {
  const parentRef = React.useRef()

  const rowVirtualizer = useVirtual({
    size: projects.length,
    parentRef,
    estimateSize: React.useCallback(() => 100, []),
    overscan: 5,
  })

  return (
    <>
      <div
        ref={parentRef}
        className="List"
        style={{
          height: "400px",
          width: "100%",
          overflow: "auto",
          maxHeight: "25rem",
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.totalSize}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.virtualItems.map(virtualRow => {
            const project = projects[virtualRow.index]
            return (
              <div
                key={virtualRow.index}
                className="rounded-xl hover:bg-bgSecondary px-3 py-3 cursor-pointer flex items-center flex-nowrap"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => onProjectSelected(project)}
              >
                <div className="w-10">{activeProjectId === project.id && <CheckOutlined className="text-2xl" />}</div>
                <div>
                  <div className="text-lg text-heading font-bold">{project.name}</div>
                  <div className="text-secondaryText text-xxs">{project.id}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export default ProjectSwitch
