// @Libs
import { useState } from "react"
import { Progress, Tooltip } from "antd"
import { observer } from "mobx-react-lite"
import { useLocation } from "react-router-dom"
// @Services
import { generateCustomerPortalLink, CurrentSubscription } from "lib/services/billing"
// @Components
import { BillingPlanOptionsModal } from "lib/components/BillingPlanOptions/BillingPlanOptions"
// @Hooks
import { useServices } from "hooks/useServices"
// @Utils
import { numberFormat } from "lib/commons/utils"
// @Styles
import styles from "./BillingCurrentPlan.module.less"

export type CurrentPlanProps = {
  planStatus: CurrentSubscription
  onPlanChangeModalOpen: () => void
}

export const BillingCurrentPlanComponent: React.FC<CurrentPlanProps> = ({ planStatus, onPlanChangeModalOpen }) => {
  const location = useLocation()
  const [upgradeDialogVisible, setUpgradeDialogVisible] = useState(
    location.search && !!new URLSearchParams(location.search).get("planUpgrade")
  )

  const services = useServices()
  const usagaPct = (planStatus.usage.events / planStatus.currentPlan.quota.events) * 100
  let customerPortalLink = generateCustomerPortalLink({
    project_id: services.activeProject.id,
    user_email: services.userService.getUser().email,
    return_url: window.location.href,
  })
  return (
    <>
      <div className="w-full">
        <div>
          You're on <b className="capitalize">{planStatus.currentPlan.name}</b> plan
        </div>
        <div>
          <div>
            <Progress percent={usagaPct} showInfo={false} status={usagaPct >= 100 ? "exception" : "active"} />
          </div>
          <table>
            <tbody>
              <tr>
                <td className={styles.limitName}>Events</td>
                <td className={styles.limitValue}>
                  {numberFormat(planStatus.usage.events)} / {numberFormat(planStatus.currentPlan.quota.events)}
                </td>
              </tr>
              <tr>
                <td className={styles.limitName}>Sources</td>
                <td className={styles.limitValue}>
                  {numberFormat(planStatus.usage.sources)} / {numberFormat(planStatus.currentPlan.quota.sources)}
                </td>
              </tr>
              <tr>
                <td className={styles.limitName}>Destinations</td>
                <td className={styles.limitValue}>
                  {numberFormat(planStatus.usage.destinations)} /{" "}
                  {numberFormat(planStatus.currentPlan.quota.destinations)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {planStatus.currentPlan.id !== "free" && (
          <div className="text-xs">
            The plan {planStatus.autorenew ? "renews" : "expires"} on{" "}
            <b>{planStatus.expiration.format("MMM Do, YYYY")}</b>
          </div>
        )}
        <div className="text-center mt-2 flex flex-col items-center space-y-4">
          {planStatus.currentPlan.id === "free" ? (
            <a
              onClick={() => {
                services.analyticsService.track("upgrade_plan_requested")
                setUpgradeDialogVisible(() => {
                  onPlanChangeModalOpen()
                  return true
                })
              }}
            >
              <b>Upgrade</b>
            </a>
          ) : planStatus.subscriptionIsManagedByStripe ? (
            <a href={customerPortalLink}>Manage Subscription</a>
          ) : (
            <Tooltip
              className="cursor-pointer"
              title={
                <>
                  Your subscription is managed by a custom contact. Email <code>support@jitsu.com</code> to make any
                  changes
                </>
              }
            >
              Manage Subscription
            </Tooltip>
          )}

          <a href="https://jitsu.com/pricing">Pricing Info</a>
        </div>
      </div>
      <BillingPlanOptionsModal
        key={"upgradeOptionsModal"}
        planStatus={planStatus}
        visible={upgradeDialogVisible}
        onCancel={() => {
          setUpgradeDialogVisible(false)
        }}
      />
    </>
  )
}

const BillingCurrentPlan = observer(BillingCurrentPlanComponent)

BillingCurrentPlan.displayName = "BillingCurrentPlan"

export { BillingCurrentPlan }
