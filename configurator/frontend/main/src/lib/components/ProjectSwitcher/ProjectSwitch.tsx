import { Badge, Button, Input, Modal } from "antd"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { useServices } from "../../../hooks/useServices"
import { CenteredSpin } from "../components"
import { ErrorCard } from "../ErrorCard/ErrorCard"
import PlusOutlined from "@ant-design/icons/PlusOutlined"
import CheckOutlined from "@ant-design/icons/CheckOutlined"
import useProject from "../../../hooks/useProject"
import { Project } from "../../../generated/conf-openapi"
import { debounce } from "lodash"
import React, { useCallback, useState } from "react"

export type ProjectSwitchProps = {
  onSelect: (project: Project, activeProject: Project) => void
  onNewProject: () => void
}

function getRenderedProjects(projects: Project[]) {
  return  projects;
  // const res = [...projects]
  // const prj = projects[0]
  // for (let i = 0; i <= 1000; i++) {
  //   res.push({ id: prj.id + ("_" + i), name: prj.name + ("_" + i) })
  // }
  // return res
}

const ProjectList: React.FC<ProjectSwitchProps> = ({ onSelect }) => {
  const services = useServices()
  const [searchString, setSearchString] = useState<string | undefined>()
  const activeProject = useProject()
  const {
    isLoading,
    error,
    data: projects,
  } = useLoaderAsObject(async () => {
    return services.projectService.getAvailableProjects()
  }, [])
  if (isLoading) {
    return <CenteredSpin />
  } else if (error) {
    return <ErrorCard title="Error getting projects" error={error} />
  } else if (!projects) {
    return <ErrorCard title="Projects are empty" />
  }

  const handleSearchChange = debounce(e => {
    setSearchString(e.target.value)
  }, 500)

  return (
    <>
      {getRenderedProjects(projects).length >= 5 && <div className="mb-6">
        <Input autoFocus onChange={handleSearchChange} placeholder="Search" />
      </div>}
      <div className="overflow-y-auto" style={{ maxHeight: "25rem" }}>
        {getRenderedProjects(projects)
          .filter(
            project =>
              !searchString ||
              searchString.trim() === "" ||
              project.name.toLowerCase().indexOf(searchString.toLowerCase()) >= 0 ||
              project.id.toLowerCase().indexOf(searchString.toLowerCase()) >= 0
          )
          .map(project => (
            <div
              key={project.id}
              className="rounded-xl hover:bg-bgSecondary px-3 py-3 cursor-pointer flex items-center flex-nowrap"
              onClick={() => onSelect(project, activeProject)}
            >
              <div className="w-10">{activeProject.id === project.id && <CheckOutlined className="text-2xl" />}</div>
              <div>
                <div className="text-lg text-heading font-bold">{project.name}</div>
                <div className="text-secondaryText text-xxs">{project.id}</div>
              </div>
            </div>
          ))}
      </div>
    </>
  )
}

const ProjectSwitch: React.FC<ProjectSwitchProps> = props => {
  return (
    <div>
      <div className="flex flex-row justify-between">
        <div className="text-xl">Select project</div>
        <div>
          <Badge count="Soon" color="green">
            <Button type="default" icon={<PlusOutlined />} onClick={() => props.onNewProject()} disabled={true}>
              New Project
            </Button>
          </Badge>
        </div>
      </div>
      <div className="py-6">
        <ProjectList {...props} />
      </div>
    </div>
  )
}

export function showProjectSwitchModal() {
  let modal = Modal.info({
    title: null,
    icon: null,
    okText: "Close",
    content: (
      <ProjectSwitch
        onSelect={(project, activeProject) => {
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

export default ProjectSwitch
