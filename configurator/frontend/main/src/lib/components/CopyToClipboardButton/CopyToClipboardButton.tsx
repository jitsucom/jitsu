import { Button, Tooltip, ButtonProps } from "antd"
import { useTimeoutResetState } from "hooks/useTimeoutResetState"

type Props = {
  copyText: string
  hoverTooltipTitle?: string
  onCopyTooltipTitle?: string
  tooltipResetMs?: number
  onAfterCopy?: () => void | Promise<void>
} & ButtonProps

export const CopyToClipboardButton: React.FC<Props> = ({
  copyText,
  hoverTooltipTitle = "📋 Copy",
  onCopyTooltipTitle = "✅ Copied",
  tooltipResetMs = 5000,
  onAfterCopy,
  children,
  ...buttonProps
}) => {
  const [copied, setCopied] = useTimeoutResetState<boolean>(false, tooltipResetMs)
  const handleClick = async (event: React.MouseEvent<HTMLElement, MouseEvent>) => {
    await buttonProps.onClick?.(event)
    await navigator.clipboard?.writeText?.(copyText)
    setCopied(true)
    onAfterCopy?.()
  }
  return (
    <Tooltip title={copied ? onCopyTooltipTitle : hoverTooltipTitle}>
      <Button onClick={handleClick} {...buttonProps}>
        {children}
      </Button>
    </Tooltip>
  )
}
