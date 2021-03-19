import { FormInstance } from "antd/lib/form/hooks/useForm";
import { DestinationConfig } from "@./lib/services/destinations";
import * as React from "react";
import { Form, Input, Modal, Radio } from "antd";
import { LabelWithTooltip } from "@./lib/components/components";
import { ReactNode } from "react";
import { dialogsByType } from "@page/DestinationsPage/partials/DestinationDialog/DestinationDialog.impl";
import PostgresDestinationDialog from "@page/DestinationsPage/partials/DestinationDialog/PostgresDestinationDialog";

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