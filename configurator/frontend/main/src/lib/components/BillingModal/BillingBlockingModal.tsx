import { ReactElement, useState } from "react"
import { Button, Modal, Typography } from "antd"
import { UpgradePlan } from "../../../ui/components/CurrentPlan/CurrentPlan"
import { CurrentSubscription } from "../../services/billing"
import { useServices } from "../../../hooks/useServices"
import { reloadPage } from "../../commons/utils"

export type BillingBlockingModalProps = {
  /**
   * Description of what exact quota is overused
   */
  blockingReason: ReactElement

  subscription: CurrentSubscription

  closeable?: boolean
}
/**
 * Displays a blocking modal dialog indicating that user overused
 * quota
 * @param props
 * @constructor
 */
const BillingBlockingModal = (props: BillingBlockingModalProps) => {
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
        <p>
          Your account is paused due to usage about the quota: <>{props.blockingReason} </>
        </p>
        <p>
          You can't edit the configuration. As a courtesy we kept you data flowing through Jitsu. However, we reserve
          the right to pause it at any moment
        </p>
        <p>
          Please upgrade to any of the <a href="https://jitsu.com/pricing">following plans</a>:{" "}
        </p>
        <UpgradePlan planStatus={props.subscription} />
      </div>
    </Modal>
  )
}

export default BillingBlockingModal
