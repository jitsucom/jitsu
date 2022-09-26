import React, { ReactNode, useEffect, useState } from "react"
import { loadProjectSettings, ProjectSettings, saveProjectSettings } from "../../../utils/projectSettings"
import { CenteredError, CenteredSpin, handleError } from "../../../lib/components/components"
import { actionNotification } from "../../components/ActionNotification/ActionNotification"
import { FormActions, FormField, FormLayout } from "../../../lib/components/Form/Form"
import { Button, Checkbox, Form, Input, Modal, Tooltip } from "antd"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import useForm from "antd/lib/form/hooks/useForm"
import { flatten, reloadPage, sleep, unflatten } from "lib/commons/utils"
import { useServices } from "../../../hooks/useServices"
import useProject from "../../../hooks/useProject"
import { ErrorCard } from "../../../lib/components/ErrorCard/ErrorCard"
import { BilledButton } from "lib/components/BilledButton/BilledButton"
import { ProjectUserPermissions } from "../../../generated/conf-openapi"
import { allPermissions, PermissionType } from "../../../lib/services/permissions"

export default function ProjectSettingsPage() {
  return (
    <div>
      <SettingsPanel title={"Project Name"}>
        <ProjectName />
      </SettingsPanel>

      <SettingsPanel
        title={"Notifications"}
        documentation={
          <>
            Configure{" "}
            <a href="https://api.slack.com/messaging/webhooks" target="_blank">
              slack webhook
            </a>{" "}
            to receive notifications about synchronization tasks statuses
          </>
        }
      >
        <SlackSettings />
      </SettingsPanel>
      <SettingsPanel title={"Users"} documentation={<>Share your project with other users</>}>
        <UsersSettings />
      </SettingsPanel>
    </div>
  )
}

const ProjectName: React.FC<{}> = () => {
  let services = useServices()
  let [projectName, setProjectName] = useState(services.activeProject.name)
  let [pending, setPending] = useState<boolean>(false)
  let [form] = useForm<{ projectName: string }>()
  useEffect(() => {
    form.setFieldsValue({ projectName })
  }, [projectName])

  let onSave = async () => {
    if (!form.isFieldsTouched()) {
      return
    }

    setPending(true)
    try {
      await services.backendApiClient.patch(
        `/projects/${services.activeProject.id}`,
        { name: form.getFieldsValue()["projectName"] },
        { version: 2 }
      )
      services.activeProject.name = projectName
      actionNotification.success("Project name has been updated")
      reloadPage()
    } catch (e) {
      actionNotification.error(`${e}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <>
        <Form form={form} onFinish={onSave}>
          <FormLayout>
            <FormField
              label="Project Name"
              tooltip="Slack webhook URL for sending task status updates"
              key="projectName"
            >
              <Form.Item name="projectName">
                <Input size="large" name="projectName" placeholder="Project name" disabled={pending} />
              </Form.Item>
            </FormField>
          </FormLayout>
          <FormActions>
            <Button type="primary" size="large" htmlType="submit" loading={pending}>
              Save
            </Button>
          </FormActions>
        </Form>
      </>
    </>
  )
}

const SettingsPanel: React.FC<{ title: ReactNode; documentation?: ReactNode }> = ({
  title,
  children,
  documentation,
}) => {
  return (
    <div className="flex justify-center">
      <div className="w-full pt-8 px-4" style={{ maxWidth: "1000px" }}>
        <div className="border rounded-md border-splitBorder p-8">
          <h2 className="text-2xl pb-0 mb-0">{title}</h2>
          {documentation && <div className="text-secondaryText mb-4">{documentation}</div>}
          <div>{children}</div>
        </div>
      </div>
    </div>
  )
}

const UserSettings: React.FC<{
  user: ProjectUserPermissions
  unlinkUser: ({ id, email }: { id: string; email: string }) => void
}> = ({ user, unlinkUser }) => {
  const services = useServices()
  const [showPermissions, setShowPermissions] = useState(false)
  const canEditPermissions =
    services.userService.getUser().id === user.id
      ? "You can't edit your own permissions"
      : services.currentProjectPermissions.has("modify_config")
      ? " You don't have enough permissions to edit other users"
      : null
  return (
    <div className="flex flex-col">
      <div key={user.id} className="w-full flex justify-between items-center -ml-2 p-2 rounded-md hover:bg-bgComponent">
        <div key="email" className="text-secondaryText text-lg font-bold">
          {user.email}
        </div>
        <div>
          <Button className="mr-3 w-36" type="default" onClick={() => setShowPermissions(!showPermissions)}>
            {canEditPermissions ? "View Permissions" : "Edit Permissions"}
          </Button>
          <Button type="default" danger onClick={() => unlinkUser(user)}>
            Unlink user
          </Button>
        </div>
      </div>
      {showPermissions && (
        <div>
          <PermissionsEditor
            permissions={user.permissions || allPermissions}
            user={user}
            blockedReason={canEditPermissions}
          />
        </div>
      )}
    </div>
  )
}

const PermissionsEditor: React.FC<{
  permissions: PermissionType[]
  user: { id: string; email: string }
  blockedReason: string | null
}> = ({ permissions, user, blockedReason }) => {
  const [grantedPermissions, setGrantedPermissions] = useState<Set<PermissionType>>(new Set(permissions))
  const [updating, setUpdating] = useState(false)
  const services = useServices()
  const activeProject = useProject()
  return (
    <div className="flex items-center">
      {allPermissions.map(p => (
        <Checkbox key={p}
          disabled={updating || !!blockedReason}
          checked={grantedPermissions.has(p)}
          onChange={async e => {
            const copy = new Set(grantedPermissions)
            if (e.target.checked) {
              copy.add(p)
            } else {
              copy.delete(p)
            }
            try {
              setUpdating(true)
              await services.projectService.updatePermissions(activeProject.id, user.id, [...copy])
              setGrantedPermissions(copy)
              actionNotification.success(
                <>
                  Permissions of <b>{user.email}</b> has been updated
                </>
              )
            } catch (e) {
              actionNotification.error(
                <>
                  Error while updating permissions of <b>{user.email}</b>
                  {e?.message ? `: ${e.message}` : ""}
                </>
              )
            } finally {
              setUpdating(false)
            }
          }}
        >
          {p}
        </Checkbox>
      ))}
      {blockedReason && <span className={"ml-1 text-sm text-secondaryText"}> - {blockedReason}</span>}
    </div>
  )
}

const UsersSettings: React.FC<{}> = () => {
  const services = useServices()
  const activeProject = useProject()
  const {
    isLoading,
    error,
    data: users,
    reloader,
  } = useLoaderAsObject(async () => {
    return await services.projectService.getProjectUsers(activeProject.id)
  })
  if (isLoading) {
    return <CenteredSpin />
  } else if (error) {
    return <ErrorCard title="Can't load users" error={error} />
  } else if (!users) {
    return <ErrorCard title="Users list is empty" />
  }

  const linkUser = async (userEmail: string) => {
    const result = await services.projectService.linkUserToProject(services.activeProject.id, { userEmail })
    if (result == "invitation_sent") {
      actionNotification.success(
        <>
          Invitation has been sent to <b>{userEmail}</b>. The user will need to create account first
        </>
      )
    } else {
      actionNotification.success(
        <>
          User <b>{userEmail}</b> already has an account, they has been granted with access to this project
        </>
      )
    }
    await reloader()
  }

  const unlinkUser = ({ id, email }: { id: string; email: string }) => {
    if (id === services.userService.getUser().id) {
      alert("You can't unlink yourself from the project!")
      return
    }
    Modal.confirm({
      title: "Confirm removal of project member",
      content: (
        <>
          You're about to remove <b>{email}</b> from your project. Are you sure you want to continue?
        </>
      ),
      onOk: async () => {
        try {
          await services.projectService.unlinkFromProject(activeProject.id, id)
        } catch (e) {
          handleError(e)
        } finally {
          await reloader()
        }
      },
    })
  }

  return (
    <div>
      {users.map(user => (
        <UserSettings key={user.id} user={user} unlinkUser={unlinkUser} />
      ))}
      <div className="pt-6">
        <InviteUserForm invite={linkUser} />
      </div>
    </div>
  )
}

const InviteUserForm: React.FC<{ invite: (email: string) => Promise<void> }> = ({ invite }) => {
  const [inputVisible, setInputVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [email, setEmail] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  return (
    <>
      <div className="flex transition-all duration-1000">
        <Input
          size="large"
          onChange={e => setEmail(e.target.value)}
          placeholder="Enter email"
          disabled={pending}
          className={`${inputVisible ? "opacity-100 w-full mr-4" : "opacity-0 w-0 m-0 p-0 invisible"}`}
        />
        <BilledButton
          plansBlacklist={["free"]}
          type="primary"
          size="large"
          loading={pending}
          onClick={async () => {
            if (!inputVisible) {
              setInputVisible(true)
            } else {
              setPending(true)
              try {
                await invite(email)
                setInputVisible(false)
              } catch (e) {
                setErrorMessage("Failed to add user to the project: " + e.message)
              } finally {
                setPending(false)
              }
            }
          }}
        >
          {inputVisible ? "Send invitation" : "Add user to the project"}
        </BilledButton>
      </div>
      <div className={`text-error ${errorMessage ? "visible" : "invisible"}`}>{errorMessage || "-"}</div>
    </>
  )
}

function SlackSettings() {
  let { error, data, setData, isLoading: loading } = useLoaderAsObject(loadProjectSettings)
  let [pending, setPending] = useState<boolean>()
  let [form] = useForm<ProjectSettings>()
  useEffect(() => {
    form.setFieldsValue(flatten(data))
  }, [data])

  let onSave = async () => {
    if (!form.isFieldsTouched()) {
      return
    }

    setPending(true)
    try {
      setData(await saveProjectSettings(unflatten(form.getFieldsValue())))
      actionNotification.success("Slack notification settings has been saved")
    } catch (e) {
      actionNotification.error(`${e}`)
    } finally {
      setPending(false)
    }
  }

  let onSlackTest = async () => {
    let url = unflatten<ProjectSettings>(form.getFieldsValue()).notifications?.slack?.url
    try {
      let response = await fetch(url, {
        method: "POST",
        body: `{"text": "Jitsu test notification"}`,
      })

      if (!response.ok) {
        throw new Error(response.statusText)
      }

      actionNotification.success("Slack test notification OK")
    } catch (e) {
      actionNotification.error(`Failed to send Slack test notification: ${e.message}`)
      console.log(e)
    }
  }

  return (
    <>
      {loading && !data && <CenteredSpin />}
      {!!error && !data && <CenteredError error={error} />}
      {!error && !!data && (
        <>
          <Form form={form} onFinish={onSave}>
            <FormLayout>
              <FormField
                label="Slack"
                tooltip="Slack webhook URL for sending task status updates"
                key="notifications.slack.url"
              >
                <Form.Item name="notifications.slack.url">
                  <Input size="large" name="notifications.slack.url" placeholder="Webhook URL" disabled={pending} />
                </Form.Item>
              </FormField>
            </FormLayout>
            <FormActions>
              <Button type="default" size="large" htmlType="submit" loading={pending} onClick={onSlackTest}>
                Test
              </Button>
              <Button type="primary" size="large" htmlType="submit" loading={pending}>
                Save
              </Button>
            </FormActions>
          </Form>
        </>
      )}
    </>
  )
}
