// @Libs
import { useCallback, useState } from "react"
import { Button, Col, FormInstance, Popconfirm, Row } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
// @Components
import { OauthButton } from "../OauthButton/OauthButton"
// @Utils
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"

type Props = {
  sourceDataFromCatalog: CatalogSourceConnector
  disabled?: boolean
  onlyManualAuth?: boolean
  onIsOauthSupportedChange?: (supported: boolean) => void
  onFillAuthDataManuallyChange?: (setManually: boolean) => void
  setOauthSecretsToForms?: (secrets: PlainObjectWithPrimitiveValues) => void
}

type Forms = {
  [key: string]: FormInstance<PlainObjectWithPrimitiveValues>
}

export const SourceEditorOauthButtons: React.FC<Props> = ({
  sourceDataFromCatalog,
  disabled,
  onlyManualAuth,
  onIsOauthSupportedChange,
  onFillAuthDataManuallyChange,
  setOauthSecretsToForms,
}) => {
  const [isOauthSupported, setIsOauthSupported] = useState<boolean>(false)
  const [fillAuthDataManually, setFillAuthDataManually] = useState<boolean>(true)

  const handleIsOauthSupportedStatusChange = useCallback<(isSupported: boolean) => void>(isSupported => {
    setIsOauthSupported(isSupported)
    onIsOauthSupportedChange?.(isSupported)
  }, [])

  const handleFillAuthDataManuallyToggle = useCallback<() => void>(() => {
    setFillAuthDataManually(fillManually => {
      const newValue = !fillManually
      !onlyManualAuth && onFillAuthDataManuallyChange?.(fillManually)
      return newValue
    })
  }, [onlyManualAuth])

  return (
    <Row key="oauth-button" className="h-8 mb-5">
      <Col span={4} />
      <Col span={20} className="flex items-center pl-2">
        <div>
          <OauthButton
            key="oauth-button"
            service={sourceDataFromCatalog.id}
            forceNotSupported={sourceDataFromCatalog.expertMode}
            className="mr-3"
            disabled={disabled}
            icon={<span className="align-middle h-5 w-7 pr-3 ">{sourceDataFromCatalog.pic}</span>}
            isGoogle={
              sourceDataFromCatalog.id.toLowerCase().includes("google") ||
              sourceDataFromCatalog.id.toLowerCase().includes("firebase")
            }
            setAuthSecrets={setOauthSecretsToForms}
            onIsOauthSuppotedStatusUpdate={handleIsOauthSupportedStatusChange}
          >
            <span className="align-top">{`Authorize Jitsu`}</span>
          </OauthButton>
        </div>
        {!onlyManualAuth && (
          <>
            <span className="pr-3 text-secondaryText">or</span>
            <Popconfirm
              title="This will reset all manual inputs. Are you sure you want to exit?"
              onConfirm={handleFillAuthDataManuallyToggle}
              disabled={fillAuthDataManually}
            >
              <Button onClick={fillAuthDataManually ? handleFillAuthDataManuallyToggle : undefined}>
                {fillAuthDataManually ? "Fill Auth Data Manually" : "Hide Manual Settings"}
              </Button>
            </Popconfirm>
          </>
        )}
      </Col>
    </Row>
  )
}
