// @Libs
import { useCallback, useState } from "react"
import { Button, Col, FormInstance, Popconfirm, Row } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "@jitsu/catalog/sources/types"
// @Components
import { OauthButton } from "../OauthButton/OauthButton"

type Props = {
  sourceDataFromCatalog: CatalogSourceConnector
  disabled?: boolean
  isSignedIn?: boolean
  onIsOauthSupportedCheckSuccess?: (supported: boolean) => void
  onFillAuthDataManuallyChange?: (setManually: boolean) => void
  setOauthSecretsToForms?: (secrets: PlainObjectWithPrimitiveValues) => void
}

export const SourceEditorOauthButtons: React.FC<Props> = ({
  sourceDataFromCatalog,
  disabled,
  isSignedIn,
  onIsOauthSupportedCheckSuccess,
  onFillAuthDataManuallyChange,
  setOauthSecretsToForms,
}) => {
  const [fillAuthDataManually, setFillAuthDataManually] = useState<boolean>(true)
  const [isOauthSupported, setIsOauthSupported] = useState<boolean>(false)

  const handleFillAuthDataManuallyToggle = useCallback<() => void>(() => {
    setFillAuthDataManually(value => {
      const newValue = !value
      onFillAuthDataManuallyChange?.(value)
      return newValue
    })
  }, [])

  const handleOauthSupportCheckStatus = useCallback<(supported: boolean) => void>(
    supported => {
      onIsOauthSupportedCheckSuccess(supported)
      setIsOauthSupported(supported)
    },
    [onIsOauthSupportedCheckSuccess]
  )

  return (
    <Row key="oauth-button" className="h-8 mb-5">
      <Col span={4} />
      <Col span={20} className="flex items-center pl-2">
        <div>
          <OauthButton
            key="oauth-button"
            service={sourceDataFromCatalog.id}
            forceNotSupported={sourceDataFromCatalog.expertMode}
            disabled={disabled}
            icon={<span className="align-middle h-5 w-7 pr-3 ">{sourceDataFromCatalog.pic}</span>}
            isGoogle={
              sourceDataFromCatalog.id.toLowerCase().includes("google") ||
              sourceDataFromCatalog.id.toLowerCase().includes("firebase")
            }
            setAuthSecrets={setOauthSecretsToForms}
            onIsOauthSuppotedStatusChecked={handleOauthSupportCheckStatus}
          >
            <span className="align-top">{`${
              isSignedIn ? "Re-Sign In" : `Grant Jitsu Access to ${sourceDataFromCatalog.displayName}`
            }`}</span>
          </OauthButton>
        </div>
        {isOauthSupported && (
          <>
            <Popconfirm
              title="This will reset all manual inputs. Are you sure you want to exit?"
              onConfirm={handleFillAuthDataManuallyToggle}
              disabled={fillAuthDataManually}
            >
              <Button type="link" onClick={fillAuthDataManually ? handleFillAuthDataManuallyToggle : undefined}>
                {fillAuthDataManually ? "Fill Auth Credentials Manually" : "Exit Manual Mode"}
              </Button>
            </Popconfirm>
          </>
        )}
      </Col>
    </Row>
  )
}
