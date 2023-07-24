import { ReactElement, useEffect } from "react"
import { Redirect } from "react-router-dom"
import { useServices } from "hooks/useServices"
import { CurrentSubscription, showQuotaLimitModal } from "lib/services/billing"

type Props = {
  quotaExceededRedirectTo: string
  quotaExceedeMessage: ReactElement
  isQuotaExceeded: (subscription: CurrentSubscription | null | undefined) => boolean
}


export const BillingCheckRedirect: React.FC<Props> = ({
  quotaExceededRedirectTo,
  quotaExceedeMessage,
  isQuotaExceeded,
  children,
}) => {
  const services = useServices()
  const isQuotaLimitReached: boolean =
    services.features.billingEnabled &&
    !services.currentSubscription.doNotBlock &&
    isQuotaExceeded(services.currentSubscription)

  useEffect(() => {
    if (isQuotaLimitReached) showQuotaLimitModal(services.currentSubscription, quotaExceedeMessage)
  }, [])

  return isQuotaLimitReached ? <Redirect to={quotaExceededRedirectTo} /> : <>{children}</>
}
