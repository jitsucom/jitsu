// @Libs
import * as React from "react"
import { useState } from "react"
import { NavLink, useHistory, useLocation } from "react-router-dom"
import { Button, Dropdown, message, MessageArgsProps, Modal, notification, Popover, Tooltip } from "antd"
// @Components
import { NotificationsWidget } from "lib/components/NotificationsWidget/NotificationsWidget"
import { BillingCurrentPlan } from "lib/components/BillingCurrentPlan/BillingCurrentPlan"
import { handleError } from "lib/components/components"
// @Icons
import Icon, {
  ApiFilled,
  AreaChartOutlined,
  CloudFilled,
  HomeFilled,
  LogoutOutlined,
  NotificationFilled,
  SettingOutlined,
  ThunderboltFilled,
  UserOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons"
import { ReactComponent as JitsuLogo } from "icons/logo-responsive.svg"
import { ReactComponent as Cross } from "icons/cross.svg"
import { ReactComponent as DbtCloudIcon } from "icons/dbtCloud.svg"
import { ReactComponent as KeyIcon } from "icons/key.svg"
import { ReactComponent as DownloadIcon } from "icons/download.svg"
import { ReactComponent as GlobeIcon } from "icons/globe.svg"
import classNames from "classnames"
// @Model
import { Permission } from "lib/services/model"
// @Utils
import { reloadPage } from "lib/commons/utils"
// @Services
import { useServices } from "hooks/useServices"
import { AnalyticsBlock } from "lib/services/analytics"
import { CurrentSubscription } from "lib/services/billing"
// @Styles
import styles from "./Layout.module.less"
// @Misc
import { FeatureSettings } from "./lib/services/ApplicationServices"
import { usePersistentState } from "./hooks/usePersistentState"
import { SupportOptions } from "lib/components/SupportOptions/SupportOptions"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { useClickOutsideRef } from "hooks/useClickOutsideRef"
import { Breadcrumbs } from "./ui/components/Breadcrumbs/Breadcrumbs"
import ProjectLink, { stripProjectFromRoute } from "./lib/components/ProjectLink/ProjectLink"
import { User } from "./generated/conf-openapi"
import { showProjectSwitchModal } from "./lib/components/ProjectSwitch/ProjectSwitch"
import { BillingPlanOptionsModal } from "lib/components/BillingPlanOptions/BillingPlanOptions"

type MenuItem = {
  icon: React.ReactNode
  title: React.ReactNode
  link: string
  color: string
  enabled: (f: FeatureSettings) => boolean
}

const makeItem = (
  icon: React.ReactNode,
  title: React.ReactNode,
  link: string,
  color: string,
  enabled: (f: FeatureSettings) => boolean = () => true
): MenuItem => {
  return { icon, title, link, color, enabled }
}

const menuItems = [
  makeItem(<HomeFilled />, "Home", "/connections", "#77c593"),
  makeItem(<ThunderboltFilled />, "Live Events", "/events-stream", "#fccd04"),
  makeItem(<AreaChartOutlined />, "Statistics", "/dashboard", "#88bdbc"),
  makeItem(<Icon component={KeyIcon} />, "API Keys", "/api-keys", "#d79922"),
  makeItem(<ApiFilled />, "Sources", "/sources", "#d83f87"),
  makeItem(<NotificationFilled />, "Destinations", "/destinations", "#4056a1"),
  makeItem(<Icon component={DbtCloudIcon} />, "dbt Cloud Integration", "/dbtcloud", "#e76e52"),
  makeItem(<SettingOutlined />, "Project settings", "/project-settings", "#0d6050"),
  makeItem(<Icon component={GlobeIcon} />, "Geo data resolver", "/geo-data-resolver", "#41b3a3"),
  makeItem(<CloudFilled />, "Custom Domains", "/domains", "#5ab9ea", f => f.enableCustomDomains),
  makeItem(<Icon component={DownloadIcon} />, "Download Config", "/cfg-download", "#14a76c"),
]

function usePageLocation(): string {
  const location = stripProjectFromRoute(useLocation().pathname)
  const canonicalPath = location === "/" || location === "" ? "/connections" : location
  return canonicalPath.split("/")[1]
}

export const ApplicationMenu: React.FC<{ expanded: boolean }> = ({ expanded }) => {
  const services = useServices()
  const key = usePageLocation()
  const Wrapper = React.useMemo<React.FC<{ title?: string | React.ReactNode }>>(
    () =>
      expanded
        ? ({ children }) => <>{children}</>
        : ({ title, children }) => (
            <Tooltip title={title} placement="right" mouseEnterDelay={0} mouseLeaveDelay={0}>
              {children}
            </Tooltip>
          ),
    [expanded]
  )

  return (
    <div className={`max-h-full overflow-x-visible overflow-y-auto ${styles.sideBarContent_applicationMenu}`}>
      {menuItems.map(item => {
        const selected = item.link === "/" + key
        const enabled = item.enabled(services.features)
        return (
          enabled && (
            <ProjectLink to={item.link} key={item.link}>
              <Wrapper title={item.title}>
                <div
                  key={item.link}
                  className={`flex items-center ${
                    selected ? styles.selectedMenuItem : styles.sideBarContent_item__withRightBorder
                  } ${styles.menuItem} whitespace-nowrap text-textPale py-3 ml-2 pl-4 pr-6 rounded-l-xl`}
                  style={{ fill: item.color }}
                >
                  <i className="block">{item.icon}</i>
                  {expanded && <span className="pl-2 whitespace-nowrap">{item.title}</span>}
                </div>
              </Wrapper>
            </ProjectLink>
          )
        )
      })}
    </div>
  )
}

export const ApplicationSidebar: React.FC<{}> = () => {
  const [expanded, setExpanded] = usePersistentState<boolean>(true, "jitsu_menuExpanded")

  return (
    <div className={`relative ${styles.sideBarContent}`}>
      <div className="flex flex-col items-stretch h-full">
        <div className={`pb-3 ${styles.sideBarContent_item__withRightBorder} app-logo-wrapper`}>
          <NavLink to="/" className={`text-center block pt-5 h-14 overflow-hidden ${expanded ? "" : "w-12 pl-3"}`}>
            <JitsuLogo className={`h-8 w-40`} />
          </NavLink>
        </div>
        <div className={`flex-grow flex-shrink min-h-0 ${styles.sideBarContent_item__withRightBorder}`}>
          <ApplicationMenu expanded={expanded} />
        </div>
        <div
          className={`flex justify-center items-center py-2 ${styles.sideBarContent_item__withRightBorder}`}
          onClick={() => setExpanded(!expanded)}
        >
          <Button
            type="text"
            className={styles.expandButton}
            icon={
              <i className={`inline-block text-center align-baseline w-3 h-full ${expanded ? "mr-2" : ""}`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`transform ${expanded ? "rotate-90" : "-rotate-90"}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path
                    fill="currentColor"
                    d="M14.121,13.879c-0.586-0.586-6.414-6.414-7-7c-1.172-1.172-3.071-1.172-4.243,0	c-1.172,1.172-1.172,3.071,0,4.243c0.586,0.586,6.414,6.414,7,7c1.172,1.172,3.071,1.172,4.243,0	C15.293,16.95,15.293,15.05,14.121,13.879z"
                  />
                  <path
                    fill="currentColor"
                    d="M14.121,18.121c0.586-0.586,6.414-6.414,7-7c1.172-1.172,1.172-3.071,0-4.243c-1.172-1.172-3.071-1.172-4.243,0	c-0.586,0.586-6.414,6.414-7,7c-1.172,1.172-1.172,3.071,0,4.243C11.05,19.293,12.95,19.293,14.121,18.121z"
                  />
                </svg>
              </i>
            }
          >
            {expanded ? <span className="inline-block h-full">{"Minimize Sidebar"}</span> : null}
          </Button>
        </div>
      </div>
    </div>
  )
}

export type PageHeaderProps = {
  user: User
  plan: CurrentSubscription
}

function abbr(user: User) {
  return user.name
    ?.split(" ")
    .filter(part => part.length > 0)
    .map(part => part[0])
    .join("")
    .toUpperCase()
}

export const PageHeader: React.FC<PageHeaderProps> = ({ plan, user, children }) => {
  const [dropdownVisible, setDropdownVisible] = useState(false)
  return (
    <div className="border-b border-splitBorder mb-0 h-14 flex flex-nowrap">
      <div className="flex-grow">
        <div className="h-14 flex items-center">{children}</div>
      </div>
      <div className={`flex-shrink flex justify-center items-center mx-1`}>
        <NotificationsWidget />
      </div>
      <div className="flex-shrink flex justify-center items-center">
        <Dropdown
          key={"userMenuDropdown"}
          trigger={["click"]}
          visible={dropdownVisible}
          overlay={<DropdownMenu user={user} plan={plan} hideMenu={() => setDropdownVisible(false)} />}
          onVisibleChange={vis => setDropdownVisible(vis)}
        >
          <Button
            className="ml-1 border-primary border-2 hover:border-text text-text hover:text-text"
            size="large"
            shape="circle"
          >
            {abbr(user) || <UserOutlined />}
          </Button>
        </Dropdown>
      </div>
    </div>
  )
}

export const DropdownMenu: React.FC<{ user: User; plan: CurrentSubscription; hideMenu: () => void }> = ({
  plan,
  user,
  hideMenu,
}) => {
  const services = useServices()
  const history = useHistory()

  const showSettings = React.useCallback<() => void>(() => history.push("/user/settings"), [history])

  const becomeUser = async () => {
    let email = prompt("Please enter e-mail of the user", "")
    if (!email) {
      return
    }
    try {
      AnalyticsBlock.blockAll()
      await services.userService.becomeUser(email)
    } catch (e) {
      handleError(e, "Can't login as other user")
      AnalyticsBlock.unblockAll()
    }
  }

  return (
    <div>
      <div className="py-5 border-b px-5 flex flex-col items-center">
        <div className="text-center text-text text-lg">{user.name}</div>
        <div className="text-secondaryText text-xs underline">{user.email}</div>
      </div>
      <div className="py-2 border-b border-main px-5 flex flex-col items-start">
        <div>
          {services.activeProject?.name && (
            <>
              Project: <b>{services.activeProject.name}</b>
            </>
          )}
          <div className="text-xs">
            <a
              onClick={() => {
                hideMenu()
                showProjectSwitchModal()
              }}
            >
              Switch project
            </a>
          </div>
        </div>
      </div>
      {services.features.billingEnabled && services.applicationConfiguration.billingUrl && (
        <div className="py-5 border-b border-main px-5 flex flex-col items-start">
          <BillingCurrentPlan planStatus={plan} onPlanChangeModalOpen={hideMenu} />
        </div>
      )}
      <div className="p-2 flex flex-col items-stretch">
        <Button type="text" className="text-left" key="settings" icon={<SettingOutlined />} onClick={showSettings}>
          Settings
        </Button>
        {(services.userService.getUser().email === "reg@ksense.io" ||
          services.userService.getUser().email.endsWith("@jitsu.com")) && (
          <Button className="text-left" type="text" key="become" icon={<UserSwitchOutlined />} onClick={becomeUser}>
            Become User
          </Button>
        )}
        <Button
          className="text-left"
          type="text"
          key="logout"
          icon={<LogoutOutlined />}
          onClick={() => services.userService.removeAuth(reloadPage)}
        >
          Logout
        </Button>
      </div>
    </div>
  )
}

function handleBillingMessage(params) {
  if (!params.get("billingMessage")) {
    return
  }

  ;(params.get("billingStatus") === "error" ? notification.error : notification.success)({
    message: params.get("billingMessage"),
    duration: 5,
  })
}

export const ApplicationPage: React.FC = ({ children }) => {
  const services = useServices()
  handleBillingMessage(new URLSearchParams(useLocation().search))
  return (
    <div className={styles.applicationPage}>
      <div className={classNames(styles.sidebar)}>
        <ApplicationSidebar />
      </div>
      <div className={classNames(styles.rightbar)}>
        <PageHeader user={services.userService.getUser()} plan={services.currentSubscription}>
          <Breadcrumbs />
        </PageHeader>
        <div className={styles.applicationPageComponent}>{children}</div>
      </div>
    </div>
  )
}

export const SlackChatWidget: React.FC<{}> = () => {
  const services = useServices()
  const [popoverVisible, setPopoverVisible] = useState<boolean>(false)
  const [upgradeDialogVisible, setUpgradeDialogVisible] = useState<boolean>(false)

  const [popoverContentRef, buttonRef] = useClickOutsideRef<HTMLDivElement, HTMLDivElement>(() => {
    setPopoverVisible(false)
  })

  const disablePrivateChannelButton: boolean = services.currentSubscription?.currentPlan?.id === "free"
  const isJitsuCloud: boolean = services.features.environment === "jitsu_cloud"
  const isPrivateSupportAvailable: boolean = services.slackApiSercice?.supportApiAvailable

  const handleUpgradeClick = () => {
    setPopoverVisible(false)
    setUpgradeDialogVisible(true)
  }

  const handleJoinPublicChannel = React.useCallback(() => {
    services.analyticsService.track("support_slack_public")
    window.open("https://jitsu.com/slack", "_blank")
  }, [])

  const handleJoinPrivateChannel = React.useCallback(async () => {
    services.analyticsService.track("support_slack_private")
    try {
      const invitationUrl = await services.slackApiSercice?.createPrivateSupportChannel(
        services.activeProject.id,
        services.activeProject.name
      )
      window.open(invitationUrl, "_blank")
    } catch (_error) {
      const error = _error instanceof Error ? _error : new Error(_error)
      actionNotification.error(
        `Failed to join a private channel due to internal error. Please, contact support via email or file an issue. Description:\n${error}`
      )
      services.analyticsService.track("support_slack_private_error", error)
    }
  }, [])

  const handleSupportEmailCopy = React.useCallback(() => {
    services.analyticsService.track("support_email_copied")
  }, [])

  return (
    <>
      <Popover
        trigger="click"
        placement="leftBottom"
        visible={popoverVisible}
        content={
          <SupportOptions
            ref={popoverContentRef}
            showEmailOption={isJitsuCloud}
            showPrivateChannelOption={isJitsuCloud && isPrivateSupportAvailable}
            disablePrivateChannelButton={disablePrivateChannelButton}
            privateChannelButtonDescription={
              disablePrivateChannelButton ? (
                <span className="text-xs text-secondaryText mb-3">
                  <a role="button" className="text-xs" onClick={handleUpgradeClick}>
                    Upgrade
                  </a>
                  {" to use this feature"}
                </span>
              ) : null
            }
            onPublicChannelClick={handleJoinPublicChannel}
            onPrivateChannelClick={handleJoinPrivateChannel}
            onEmailCopyClick={handleSupportEmailCopy}
          />
        }
      >
        <div
          ref={buttonRef}
          id="jitsuSlackWidget"
          onClick={() => {
            services.analyticsService.track("slack_invitation_open")
            setPopoverVisible(visible => !visible)
          }}
          className="fixed bottom-5 right-5 rounded-full bg-primary text-text w-12 h-12 flex justify-center items-center cursor-pointer hover:bg-primaryHover"
        >
          <span
            className={`absolute top-0 left-0 h-full w-full flex justify-center items-center text-xl transition-all duration-300 transform-gpu ${
              popoverVisible ? "opacity-100 scale-100" : "opacity-0 scale-50"
            }`}
          >
            <span className="block h-4 w-4 transform-gpu -translate-y-1/2">
              <Cross />
            </span>
          </span>
          <span
            className={`absolute top-3 left-3 transition-all duration-300 transform-gpu ${
              popoverVisible ? "opacity-0 scale-50" : "opacity-100 scale-100"
            }`}
          >
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M 4 3 C 2.9 3 2 3.9 2 5 L 2 15.792969 C 2 16.237969 2.5385156 16.461484 2.8535156 16.146484 L 5 14 L 14 14 C 15.1 14 16 13.1 16 12 L 16 5 C 16 3.9 15.1 3 14 3 L 4 3 z M 18 8 L 18 12 C 18 14.209 16.209 16 14 16 L 8 16 L 8 17 C 8 18.1 8.9 19 10 19 L 19 19 L 21.146484 21.146484 C 21.461484 21.461484 22 21.237969 22 20.792969 L 22 10 C 22 8.9 21.1 8 20 8 L 18 8 z" />
            </svg>
          </span>
        </div>
      </Popover>
      <BillingPlanOptionsModal
        planStatus={services.currentSubscription}
        onCancel={() => {
          setUpgradeDialogVisible(false)
        }}
        visible={upgradeDialogVisible}
      />
    </>
  )
}

const EmailIsNotConfirmedMessage: React.FC<{ messageKey: React.Key }> = ({ messageKey }) => {
  const services = useServices()
  const [isSendingVerification, setIsSendingVerification] = useState<boolean>(false)

  const handleDestroyMessage = () => message.destroy(messageKey)
  const handleresendConfirmationLink = async () => {
    setIsSendingVerification(true)
    try {
      await services.userService.sendConfirmationEmail()
    } finally {
      setIsSendingVerification(false)
    }
    handleDestroyMessage()
  }
  return (
    <span className="flex flex-col items-center mt-1">
      <span>
        <span>{"Email "}</span>
        {services.userService.getUser()?.email ? (
          <span className={`font-semibold ${styles.emailHighlight}`}>{services.userService.getUser()?.email}</span>
        ) : (
          ""
        )}
        <span>
          {` is not verified. Please, follow the instructions in your email
            to complete the verification process.`}
        </span>
      </span>
      <span>
        <Button type="link" loading={isSendingVerification} onClick={handleresendConfirmationLink}>
          {"Resend verification link"}
        </Button>
        <Button type="text" onClick={handleDestroyMessage}>
          {"Close"}
        </Button>
      </span>
    </span>
  )
}

const MESSAGE_KEY = "email-not-confirmed-message"

export const emailIsNotConfirmedMessageConfig: MessageArgsProps = {
  type: "error",
  key: MESSAGE_KEY,
  duration: null,
  icon: <>{null}</>,
  content: <EmailIsNotConfirmedMessage messageKey={MESSAGE_KEY} />,
}
