// @Libs
import { Button, Modal, ModalProps } from "antd"
// @Components
import { handleError } from "lib/components/components"
import { CurrentSubscription, generateCheckoutLink, generateCustomerPortalLink } from "lib/services/billing"
// @Services
import { useServices } from "hooks/useServices"
// @Styles
import styles from "./BillingPlanOptions.module.less"

export const BillingPlanOptionsModal: React.FC<{ planStatus: CurrentSubscription } & ModalProps> = ({
  planStatus,
  children,
  ...modalProps
}) => {
  return (
    <Modal
      destroyOnClose={false}
      width={800}
      title={<h1 className="text-xl m-0 p-0">Upgrade subscription</h1>}
      footer={null}
      {...modalProps}
    >
      <BillingPlanOptions planStatus={planStatus} />
    </Modal>
  )
}

export const BillingPlanOptions: React.FC<{
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
        project_id: services.activeProject.id,
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
