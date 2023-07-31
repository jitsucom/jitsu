import { Button, ButtonProps, Tooltip } from "antd"
import { useServices } from "hooks/useServices"
import { PricingPlanId } from "lib/services/billing"
import { useMemo } from "react"

type Props = {
  /** Text to display if the button is blocked */
  tooltipTitle?: string
  isBlocked?: boolean
  plansBlacklist?: PricingPlanId[]
  plansWhitelist?: PricingPlanId[]
} & ButtonProps

/**
 * Button that is blocked depending on the current subscription.
 *
 * To decide on blocking it uses on of the following:
 * - Explicit 'isBlocked' boolean
 * - Pricing plans IDs blacklist
 * - Pricing plans IDs whitelist
 *
 * Note: it is always unblocked for the 'opensource' plan
 */
export const BilledButton: React.FC<Props> = ({
  isBlocked,
  plansBlacklist,
  plansWhitelist,
  tooltipTitle,
  children,
  ...buttonProps
}) => {
  const currentPlan = useServices().currentSubscription.currentPlan
  const isButtonBlocked = useMemo<boolean>(() => {
    if (currentPlan.id === "opensource") return false
    const blackList = plansBlacklist ?? []
    const whiteList = plansWhitelist ?? []
    return isBlocked ?? blackList.includes(currentPlan.id) ?? !whiteList.includes(currentPlan.id) ?? false
  }, [isBlocked, currentPlan])

  const Wrapper = isButtonBlocked
    ? ({ children }) => (
        <Tooltip title={tooltipTitle ?? "This feature is not available in your subscription"}>{children}</Tooltip>
      )
    : ({ children }) => <>{children}</>

  return (
    <Wrapper>
      <Button {...buttonProps} disabled={isButtonBlocked}>
        {children}
      </Button>
    </Wrapper>
  )
}
