// @Libs
import { useCallback, useMemo } from "react"
import { observer } from "mobx-react-lite"
import { Form } from "antd"
// @Constants
import { SOURCE_CONNECTED_DESTINATION } from "embeddedDocs/sourcesConnectedItems"
// @Components
import { NameWithPicture, ConnectedItem, ConnectedItems } from "ui/components/ConnectedItems/ConnectedItems"
import { TabDescription } from "ui/components/Tabs/TabDescription"
// @Reference
import { destinationsReferenceMap } from "catalog/destinations/lib"
// @Types
import { FormInstance } from "antd/lib/form/hooks/useForm"
import { Destination } from "catalog/destinations/types"
// @Utils
import { destinationsStore } from "stores/destinations"

export interface Props {
  form: FormInstance
  initialValues: SourceData
  handleTouchAnyField: (...args: any) => void
}

function getDescription(reference: Destination) {
  if (reference.syncFromSourcesStatus === "supported") {
    return null
  } else if (reference.syncFromSourcesStatus === "coming_soon") {
    return `${reference.displayName} synchronization is coming soon! At the moment, it's not available`
  } else {
    return `${reference.displayName} synchronization is not supported`
  }
}

const SourceEditorDestinationsComponent = ({ form, initialValues, handleTouchAnyField }: Props) => {
  const destinations = destinationsStore.destinations

  const destinationsList = useMemo<ConnectedItem[]>(
    () =>
      destinations?.map((dst: DestinationData) => {
        const reference = destinationsReferenceMap[dst._type]
        return {
          id: dst._uid,
          disabled: reference.syncFromSourcesStatus !== "supported",
          title: (
            <NameWithPicture icon={reference.ui.icon}>
              <b>{reference.displayName}</b>: {dst.displayName || dst._id}
            </NameWithPicture>
          ),
          description: <i className="text-xs">{getDescription(reference)}</i>,
        }
      }) ?? [],
    [destinations]
  )

  const preparedInitialValue = useMemo(() => initialValues?.destinations ?? [], [initialValues])

  const handleItemChange = useCallback(
    (items: string[]) => {
      const beenTouched = JSON.stringify(items) !== JSON.stringify(initialValues.destinations)

      handleTouchAnyField(beenTouched)
    },
    [initialValues, handleTouchAnyField]
  )

  return (
    <>
      <TabDescription>{SOURCE_CONNECTED_DESTINATION}</TabDescription>

      <Form form={form} name="connected-destinations">
        <ConnectedItems
          form={form}
          fieldName="destinations"
          itemsList={destinationsList}
          warningMessage={<p>Please, choose at least one source.</p>}
          initialValues={preparedInitialValue}
          handleItemChange={handleItemChange}
        />
      </Form>
    </>
  )
}

const SourceEditorDestinations = observer(SourceEditorDestinationsComponent)

SourceEditorDestinations.displayName = "SourceEditorDestinations"

export { SourceEditorDestinations }
