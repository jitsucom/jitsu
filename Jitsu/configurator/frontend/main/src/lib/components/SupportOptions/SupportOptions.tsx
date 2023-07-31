// @Libs
import { forwardRef, Fragment, SVGProps, useState } from "react"
import { Button } from "antd"
// @Icons
import Icon from "@ant-design/icons"
import { CopyToClipboardButton } from "../CopyToClipboardButton/CopyToClipboardButton"

type Props = {
  disablePrivateChannelButton?: boolean
  privateChannelButtonDescription?: string | React.ReactNode | null
  showEmailOption?: boolean
  showPrivateChannelOption?: boolean
  onPrivateChannelClick?: VoidFunction | null
  onPublicChannelClick?: VoidFunction | null
  onEmailCopyClick?: VoidFunction | null
}

export const SupportOptions = forwardRef<HTMLDivElement, Props>(
  (
    {
      disablePrivateChannelButton,
      privateChannelButtonDescription,
      showEmailOption,
      showPrivateChannelOption,
      onPrivateChannelClick,
      onPublicChannelClick,
      onEmailCopyClick,
    },
    ref
  ) => {
    const [isPrivateChannelLoading, setIsPrivateChannelLoading] = useState<boolean>(false)

    const handlePrivateChannelClick = async () => {
      setIsPrivateChannelLoading(true)
      try {
        await onPrivateChannelClick()
      } finally {
        setIsPrivateChannelLoading(false)
      }
    }
    return (
      <div ref={ref} className="w-full h-full max-w-xs">
        <div className="flex flex-col justify-center items-center">
          {showPrivateChannelOption && (
            <Fragment key="private-slack">
              <div className="text-md mb-2">
                Create a private Slack channel for a real-time conversations with our team. The channel will appear in a
                Slack workspace of your choice
              </div>
              <Button
                size="large"
                type="primary"
                disabled={!!disablePrivateChannelButton}
                loading={isPrivateChannelLoading}
                icon={<Icon component={SlackIcon} />}
                className={`w-full mb-${privateChannelButtonDescription ? "1" : "3"}`}
                onClick={handlePrivateChannelClick}
              >
                Create a Private Support Channel
              </Button>
              {typeof privateChannelButtonDescription === "string" ? (
                <span className="text-xs text-secondaryText mb-3">{privateChannelButtonDescription}</span>
              ) : privateChannelButtonDescription ? (
                privateChannelButtonDescription
              ) : null}
            </Fragment>
          )}
          {showEmailOption && (
            <div key="email" className="flex flex-col items-center mb-3">
              <div className="text-md mb-2">Don't want to use Slack? Feel free to contact us via email</div>
              <CopyToClipboardButton
                type="primary"
                size="large"
                icon={<Icon component={MailIcon} className={`transform translate-y-px`} />}
                copyText="support@jitsu.com"
                className="w-full"
                onAfterCopy={onEmailCopyClick}
              >
                support@jitsu.com
              </CopyToClipboardButton>
            </div>
          )}
          {onPublicChannelClick && (
            <Fragment key="public-slack">
              <div className="text-md mb-2">
                {`${
                  showPrivateChannelOption || showEmailOption
                    ? "We also have a public Slack channel!"
                    : "We'd be delighted to assist you with any issues in our Slack!"
                } 100+ members already received help from our community`}
              </div>
              <Button
                size="large"
                type="primary"
                icon={<Icon component={ChatIcon} />}
                className="w-full mb-4"
                onClick={onPublicChannelClick}
              >
                Join Public Slack Channel
              </Button>
            </Fragment>
          )}
        </div>
      </div>
    )
  }
)

const SlackIcon: React.FC<SVGProps<SVGSVGElement>> = props => (
  <svg className="fill-current" viewBox="0 0 24 24" height="1em" width="1em" {...props}>
    <path d="m8.843 12.651c-1.392 0-2.521 1.129-2.521 2.521v6.306c0 1.392 1.129 2.521 2.521 2.521s2.521-1.129 2.521-2.521v-6.306c-.001-1.392-1.13-2.521-2.521-2.521z" />
    <path d="m.019 15.172c0 1.393 1.13 2.523 2.523 2.523s2.523-1.13 2.523-2.523v-2.523h-2.521c-.001 0-.001 0-.002 0-1.393 0-2.523 1.13-2.523 2.523z" />
    <path d="m8.846-.001c-.001 0-.002 0-.003 0-1.393 0-2.523 1.13-2.523 2.523s1.13 2.523 2.523 2.523h2.521v-2.523c0-.001 0-.003 0-.005-.001-1.391-1.128-2.518-2.518-2.518z" />
    <path d="m2.525 11.37h6.318c1.393 0 2.523-1.13 2.523-2.523s-1.13-2.523-2.523-2.523h-6.318c-1.393 0-2.523 1.13-2.523 2.523s1.13 2.523 2.523 2.523z" />
    <path d="m21.457 6.323c-1.391 0-2.518 1.127-2.518 2.518v.005 2.523h2.521c1.393 0 2.523-1.13 2.523-2.523s-1.13-2.523-2.523-2.523c-.001 0-.002 0-.003 0z" />
    <path d="m12.641 2.522v6.325c0 1.392 1.129 2.521 2.521 2.521s2.521-1.129 2.521-2.521v-6.325c0-1.392-1.129-2.521-2.521-2.521-1.392 0-2.521 1.129-2.521 2.521z" />
    <g>
      <path d="m17.682 21.476c0-1.392-1.129-2.521-2.521-2.521h-2.521v2.523c.001 1.391 1.129 2.519 2.521 2.519s2.521-1.129 2.521-2.521z" />
      <path d="m21.479 12.649h-6.318c-1.393 0-2.523 1.13-2.523 2.523s1.13 2.523 2.523 2.523h6.318c1.393 0 2.523-1.13 2.523-2.523s-1.13-2.523-2.523-2.523z" />
    </g>
  </svg>
)

const ChatIcon: React.FC<SVGProps<SVGSVGElement>> = props => (
  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 32" {...props}>
    <title>bubbles2</title>
    <path d="M15 0v0c8.284 0 15 5.435 15 12.139s-6.716 12.139-15 12.139c-0.796 0-1.576-0.051-2.339-0.147-3.222 3.209-6.943 3.785-10.661 3.869v-0.785c2.008-0.98 3.625-2.765 3.625-4.804 0-0.285-0.022-0.564-0.063-0.837-3.392-2.225-5.562-5.625-5.562-9.434 0-6.704 6.716-12.139 15-12.139zM31.125 27.209c0 1.748 1.135 3.278 2.875 4.118v0.673c-3.223-0.072-6.181-0.566-8.973-3.316-0.661 0.083-1.337 0.126-2.027 0.126-2.983 0-5.732-0.805-7.925-2.157 4.521-0.016 8.789-1.464 12.026-4.084 1.631-1.32 2.919-2.87 3.825-4.605 0.961-1.84 1.449-3.799 1.449-5.825 0-0.326-0.014-0.651-0.039-0.974 2.268 1.873 3.664 4.426 3.664 7.24 0 3.265-1.88 6.179-4.82 8.086-0.036 0.234-0.055 0.474-0.055 0.718z"></path>
  </svg>
)

const MailIcon: React.FC<SVGProps<SVGSVGElement>> = props => (
  <svg
    width="100%"
    height="100%"
    version="1.1"
    viewBox="0 0 24 24"
    xmlSpace="preserve"
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    {...props}
  >
    <g id="info" />
    <g id="icons">
      <path
        d="M20,3H4C1.8,3,0,4.8,0,7v10c0,2.2,1.8,4,4,4h16c2.2,0,4-1.8,4-4V7C24,4.8,22.2,3,20,3z M21.6,8.8l-7.9,5.3   c-0.5,0.3-1.1,0.5-1.7,0.5s-1.2-0.2-1.7-0.5L2.4,8.8C2,8.5,1.9,7.9,2.2,7.4C2.5,7,3.1,6.9,3.6,7.2l7.9,5.3c0.3,0.2,0.8,0.2,1.1,0   l7.9-5.3c0.5-0.3,1.1-0.2,1.4,0.3C22.1,7.9,22,8.5,21.6,8.8z"
        id="email"
      />
    </g>
  </svg>
)
