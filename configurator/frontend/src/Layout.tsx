// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @Libs
import * as React from "react"
import { useState } from "react"
import { NavLink, Redirect, Route, useHistory, useLocation, Switch } from "react-router-dom"
import { Button, Dropdown, message, Modal, MessageArgsProps, Tooltip, notification, Popover } from "antd"
// @Components
import { BreadcrumbsProps, withHome, Breadcrumbs } from "ui/components/Breadcrumbs/Breadcrumbs"
import { NotificationsWidget } from "lib/components/NotificationsWidget/NotificationsWidget"
import { CurrentPlan, UpgradePlan } from "ui/components/CurrentPlan/CurrentPlan"
import { CenteredSpin, handleError } from "lib/components/components"
// @Icons
import Icon, {
  SettingOutlined,
  AreaChartOutlined,
  ApiOutlined,
  NotificationOutlined,
  CloudOutlined,
  DownloadOutlined,
  UserOutlined,
  UserSwitchOutlined,
  LogoutOutlined,
  PartitionOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
} from "@ant-design/icons"
import logo from "icons/logo.svg"
import logoMini from "icons/logo-square.svg"
import { ReactComponent as Cross } from "icons/cross.svg"
import { ReactComponent as DbtCloudIcon } from "icons/dbtCloud.svg"
import { ReactComponent as KeyIcon } from "icons/key.svg"
import classNames from "classnames"
// @Model
import { Permission, User } from "lib/services/model"
// @Utils
import { reloadPage } from "lib/commons/utils"
import { Page, usePageLocation } from "navigation"
// @Services
import { useServices } from "hooks/useServices"
import { AnalyticsBlock } from "lib/services/analytics"
import { CurrentSubscription } from "lib/services/billing"
// @Styles
import styles from "./Layout.module.less"
// @Misc
import { settingsPageRoutes } from "./ui/pages/SettingsPage/SettingsPage"
import { FeatureSettings } from "./lib/services/ApplicationServices"
import { usePersistentState } from "./hooks/usePersistentState"
import { ErrorBoundary } from "lib/components/ErrorBoundary/ErrorBoundary"
import { SupportOptions } from "lib/components/SupportOptions/SupportOptions"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { useClickOutsideRef } from "hooks/useClickOutsideRef"

type MenuItem = {
  icon: React.ReactNode
  title: React.ReactNode
  link: string
  enabled: (f: FeatureSettings) => boolean
}

const makeItem = (
  icon: React.ReactNode,
  title: React.ReactNode,
  link: string,
  enabled = (f: FeatureSettings) => true
): MenuItem => {
  return { icon, title, link, enabled }
}

const menuItems = [
  makeItem(<PartitionOutlined />, "Home", "/connections"),
  makeItem(<ThunderboltOutlined />, "Live Events", "/events_stream"),
  makeItem(<AreaChartOutlined />, "Statistics", "/dashboard"),
  makeItem(<Icon component={KeyIcon} />, "API Keys", "/api-keys"),
  makeItem(<ApiOutlined />, "Sources", "/sources"),
  makeItem(<NotificationOutlined />, "Destinations", "/destinations"),
  makeItem(<Icon component={DbtCloudIcon} />, "dbt Cloud Integration", "/dbtcloud"),
  makeItem(<GlobalOutlined />, "Geo data resolver", "/geo_data_resolver"),
  makeItem(<CloudOutlined />, "Custom Domains", "/domains", f => f.enableCustomDomains),
  makeItem(<DownloadOutlined />, "Download Config", "/cfg_download", f => f.enableCustomDomains),
]

export const ApplicationMenu: React.FC<{ expanded: boolean }> = ({ expanded }) => {
  const key = usePageLocation().mainMenuKey

  return (
    <div className={`max-h-full overflow-x-visible overflow-y-auto ${styles.sideBarContent_applicationMenu}`}>
      {menuItems.map(item => {
        const selected = item.link === "/" + key
        return (
          <NavLink to={item.link} key={item.link}>
            <div
              key={item.link}
              className={`${
                selected ? styles.selectedMenuItem : styles.sideBarContent_item__withRightBorder
              } whitespace-nowrap text-textPale hover:text-primaryHover py-3 ml-2 pl-4 pr-6 rounded-l-xl`}
            >
              {!expanded && (
                <Tooltip title={item.title} placement="right" mouseEnterDelay={0}>
                  {item.icon}
                </Tooltip>
              )}

              {expanded && (
                <>
                  {item.icon}
                  <span className="pl-2 whitespace-nowrap">{item.title}</span>
                </>
              )}
            </div>
          </NavLink>
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
        <div className={`pb-3 ${styles.sideBarContent_item__withRightBorder}`}>
          <a href="https://jitsu.com" className={`text-center block pt-5 h-14`}>
            <img src={expanded ? logo : logoMini} alt="[logo]" className="h-8 mx-auto" />
          </a>
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
          trigger={["click"]}
          onVisibleChange={vis => setDropdownVisible(vis)}
          visible={dropdownVisible}
          overlay={<DropdownMenu user={user} plan={plan} hideMenu={() => setDropdownVisible(false)} />}
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

  const showSettings = React.useCallback<() => void>(() => history.push(settingsPageRoutes[0]), [history])

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
          Project: <b>{services.activeProject.name || "Unspecified"}</b>
        </div>
      </div>
      {services.features.billingEnabled && services.applicationConfiguration.billingUrl && (
        <div className="py-5 border-b border-main px-5 flex flex-col items-start">
          <CurrentPlan planStatus={plan} onPlanChangeModalOpen={hideMenu} />
        </div>
      )}
      <div className="p-2 flex flex-col items-stretch">
        <Button type="text" className="text-left" key="settings" icon={<SettingOutlined />} onClick={showSettings}>
          Settings
        </Button>
        {services.userService.getUser().hasPermission(Permission.BECOME_OTHER_USER) && (
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

export type ApplicationPageWrapperProps = {
  pages: Page[]
  extraForms?: JSX.Element[]
  user: User
  plan: CurrentSubscription
  [propName: string]: any
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

export const ApplicationPage: React.FC<ApplicationPageWrapperProps> = ({ plan, pages, user, extraForms }) => {
  const location = useLocation()
  const services = useServices()
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbsProps>(
    withHome({ elements: [{ title: pages[0].pageHeader }] })
  )

  const routes = pages.map(page => {
    const Component = page.component as React.ExoticComponent
    return (
      <Route
        key={page.pageTitle}
        path={page.getPrefixedPath()}
        exact={true}
        render={routeProps => {
          services.analyticsService.onPageLoad({
            pagePath: routeProps.location.hash,
          })
          document["title"] = page.pageTitle
          // setBreadcrumbs(withHome({ elements: [{ title: page.pageHeader }] }))

          return (
            <ErrorBoundary>
              <Component setBreadcrumbs={setBreadcrumbs} {...(routeProps as any)} />
            </ErrorBoundary>
          )
        }}
      />
    )
  })

  routes.push(<Redirect key="dashboardRedirect" from="*" to="/dashboard" />)
  handleBillingMessage(new URLSearchParams(useLocation().search))

  React.useEffect(() => {
    const pageMatchingPathname = pages.find(page => page.path.includes(location.pathname))
    if (pageMatchingPathname) setBreadcrumbs(withHome({ elements: [{ title: pageMatchingPathname.pageHeader }] }))
  }, [location.pathname])

  return (
    <div className={styles.applicationPage}>
      <div className={classNames(styles.sidebar)}>
        <ApplicationSidebar />
      </div>
      <div className={classNames(styles.rightbar)}>
        <PageHeader user={user} plan={plan}>
          <Breadcrumbs {...breadcrumbs} />
        </PageHeader>
        <div className={styles.applicationPageComponent}>
          <React.Suspense fallback={<CenteredSpin />}>
            <Switch key={"appPagesSwitch"}>{routes}</Switch>
            {extraForms}
          </React.Suspense>
        </div>
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
        // ref={ref}
        trigger="click"
        placement="leftBottom"
        // destroyTooltipOnHide={{ keepParent: false }}
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
      <Modal
        destroyOnClose={true}
        width={800}
        title={<h1 className="text-xl m-0 p-0">Upgrade subscription</h1>}
        visible={upgradeDialogVisible}
        onCancel={() => {
          setUpgradeDialogVisible(false)
        }}
        footer={null}
      >
        <UpgradePlan planStatus={services.currentSubscription} />
      </Modal>
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
