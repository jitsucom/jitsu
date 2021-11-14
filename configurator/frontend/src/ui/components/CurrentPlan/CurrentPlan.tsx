import { useCallback, useMemo, useState } from "react"
import { Button, Modal, Progress, ButtonProps, Typography, Divider } from "antd"
import cn from "classnames"
import { generateCheckoutLink, generateCustomerPortalLink, CurrentSubscription } from "lib/services/billing"
import { useServices } from "hooks/useServices"
import { handleError } from "lib/components/components"
import styles from "./CurrentPlan.module.less"
import { numberFormat } from "../../../lib/commons/utils"

export type CurrentPlanProps = {
  planStatus: CurrentSubscription
  onPlanChangeModalOpen: () => void
}

export const CurrentPlan: React.FC<CurrentPlanProps> = ({ planStatus, onPlanChangeModalOpen }) => {
  const [upgradeDialogVisible, setUpgradeDialogVisible] = useState(false)
  const services = useServices()
  const usagaPct = (planStatus.usage.events / planStatus.currentPlan.quota.events) * 100
  return (
    <>
      <div>
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
                onPlanChangeModalOpen()
                onPlanChangeModalOpen()
                services.analyticsService.track("upgrade_plan_requested")
                setUpgradeDialogVisible(true)
              }}
            >
              <b>Upgrade</b>
            </a>
          ) : (
            planStatus.stripeCustomerId && (
              <a
                href={generateCustomerPortalLink({
                  project_id: services.activeProject.id,
                  user_email: services.userService.getUser().email,
                  return_url: window.location.href,
                })}
              >
                Manage Subscription
              </a>
            )
          )}

          <a href="https://jitsu.com/pricing">Pricing Info</a>
        </div>
      </div>
      <Modal
        destroyOnClose={true}
        width={800}
        title={<h1 className="text-xl m-0 p-0">Updgrade subscription</h1>}
        visible={upgradeDialogVisible}
        onCancel={() => {
          setUpgradeDialogVisible(false)
        }}
        footer={null}
      >
        <UpgradePlan planStatus={planStatus} />
      </Modal>
    </>
  )
}

export const UpgradePlan: React.FC<{
  planStatus: CurrentSubscription
}> = ({ planStatus }) => {
  const services = useServices()

  const handleProceedToCheckout = async (planId: string) => {
    try {
      await services.analyticsService.track("upgrade_plan", {
        event: "upgrade_plan",
        plan: planId,
        user: services.userService.getUser().email,
      })
      const user = services.userService.getUser()
      window.location.href = generateCheckoutLink({
        project_id: user.projects[0].id,
        user_email: user.email,
        plan_id: planId,
        redirect_base: window.location.href,
      })
    } catch (e) {
      handleError(e)
    }
  }

  return (
    <>
      <div className={styles.plan}>
        <div>
          <Button
            size="large"
            className={styles.planButton}
            type="primary"
            onClick={() => handleProceedToCheckout("growth")}
          >
            Upgrade to GROWTH
          </Button>
          <div className={styles.planPrice}>$99 / month</div>
        </div>
        <div>
          <Button
            size="large"
            className={styles.planButton}
            type="primary"
            onClick={() => handleProceedToCheckout("premium")}
          >
            Upgrade to PREMIUM
          </Button>
          <div className={styles.planPrice}>$299 / month</div>
        </div>
        <div>
          <Button size="large" type="primary" className={styles.planButton}>
            Upgrade to Enterprise
          </Button>
          <div className={styles.planPrice}>Custom. Email sales@jitsu.com</div>
        </div>
      </div>
      <div className="flex justify-center pt-3 space-x-3">
        <a target="_blank" href="https://jitsu.com/pricing" rel="noreferrer">
          Explore pricing options
        </a>
        {planStatus.stripeCustomerId && (
          <>
            <span>•</span>
            <a
              href={generateCustomerPortalLink({
                project_id: services.activeProject.id,
                user_email: services.userService.getUser().email,
                return_url: window.location.href,
              })}
            >
              Manage Subscription
            </a>
          </>
        )}
      </div>
      <div className="flex justify-center pt-3 text-secondaryText text-sm">Ask sales@jitsu.com for discounts :)</div>
    </>
  )
}
