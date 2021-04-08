import * as React from 'react';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { DestinationConfig } from '@./lib/services/destinations';
import { dialogsByType } from '@page/DestinationsPage/partials/DestinationDialog/DestinationDialog.impl';

export type ConnectionPropertiesTabProps = {
  form: FormInstance
  destination: DestinationConfig,
  onModification: () => void
}

export function ConnectionPropertiesTab(props: ConnectionPropertiesTabProps) {
  return <div>
    {React.createElement(dialogsByType[props.destination.type], {
      initialConfigValue: props.destination,
      form: props.form,
      onModification: props.onModification
    })}

  </div>
}

export default ConnectionPropertiesTab;
