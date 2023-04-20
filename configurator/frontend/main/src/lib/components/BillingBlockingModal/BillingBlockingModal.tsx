import { ReactElement, useState } from "react"
import { Button, Modal } from "antd"
import { CurrentSubscription, generateCustomerPortalLink } from "../../services/billing"
import { useServices } from "../../../hooks/useServices"
import { reloadPage } from "../../commons/utils"
import { BillingPlanOptions } from "../BillingPlanOptions/BillingPlanOptions"

export type BillingBlockingModalProps = {
  /**
   * Description of what exact quota is overused
   */
  blockingReason: ReactElement

  subscription: CurrentSubscription

  closeable?: boolean

  hasUpdateInvoices: boolean
}

function QuotaExceeded(props: { blockingReason: React.ReactElement; planStatus: CurrentSubscription }) {
  return (
    <>
      <p>
        Your account is paused due to usage about the quota: <>{props.blockingReason} </>
      </p>
      <p>
        You can't edit the configuration. As a courtesy we kept you data flowing through Jitsu. However, we reserve the
        right to pause it at any moment
      </p>
      <p>
        Please upgrade to any of the{" "}
        <a target="_blank" href="https://jitsu.com/pricing">
          following plans
        </a>
        :{" "}
      </p>
      <BillingPlanOptions planStatus={props.planStatus} />
    </>
  )
}

function UnpaidInvoices() {
  const services = useServices()
  const link = generateCustomerPortalLink({
    project_id: services.activeProject.id,
    user_email: services.userService.getUser().email,
    return_url: window.location.href,
  })
  return (
    <div>
      <div>
        You have an unpaid invoices. Please, update you payment information and{" "}
        <a href={link}>pay outstanding invoices here</a>
      </div>
      <div className="flex justify-center px-6">
        <Button href={link} type="primary" size="large">
          Restore access
        </Button>
      </div>
    </div>
  )
}

/**
 * Displays a blocking modal dialog indicating that user overused
 * quota
 * @param props
 * @constructor
 */
const BillingBlockingModal: React.FC<BillingBlockingModalProps> = props => {
  const [visible, setVisible] = useState(true)
  const services = useServices()
  return (
    <Modal
      key="billingBlockingModal"
      closable={!!props.closeable}
      visible={visible}
      footer={
        !!props.closeable ? (
          <>
            <Button type="primary" onClick={() => setVisible(false)}>
              Close
            </Button>
          </>
        ) : (
          <Button type="link" size="small" onClick={() => services.userService.removeAuth(reloadPage)}>
            Logout from Jitsu
          </Button>
        )
      }
      width={800}
      title={<span className="text-xl">Your account is paused</span>}
    >
      <div className="text-lg">
        {props.hasUpdateInvoices ? (
          <UnpaidInvoices />
        ) : (
          <QuotaExceeded blockingReason={props.blockingReason} planStatus={props.subscription} />
        )}
      </div>
    </Modal>
  )
}

export default BillingBlockingModal
