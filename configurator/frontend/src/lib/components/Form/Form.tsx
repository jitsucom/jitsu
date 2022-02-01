import React, { ReactNode } from "react"
import { LabelWithTooltip } from "../../../ui/components/LabelWithTooltip/LabelWithTooltip"
import cn from "classnames"

export const unsavedMessage = "You have unsaved changes. Are you sure you want to leave the page?"

const formItemLayout = {
  labelCol: { span: 6 },
  wrapperCol: { span: 18 },
}

type FormFieldProps = {
  label: ReactNode
  tooltip?: ReactNode
  children: ReactNode
  splitter?: boolean
}

type FormLayoutProps = {
  title?: ReactNode
  className?: string
  children: React.ReactElement<FormFieldProps> | React.ReactElement<FormFieldProps>[]
}

export const FormField: React.FC<FormFieldProps> = ({ children, label, tooltip, splitter = false }: FormFieldProps) => {
  return (
    <div className={`flex flex-nowrap items-start w-full py-4 ${splitter && "border-b border-splitBorder"}`}>
      <div style={{ width: "20em", minWidth: "20em" }} className="font-semibold">
        {tooltip ? <LabelWithTooltip documentation={tooltip} render={label} /> : label}
      </div>
      <div className="flex-grow">{children}</div>
    </div>
  )
}

// const FormActions: React.FC<{}>

export const FormLayout: React.FC<FormLayoutProps> = ({ className, children, title }) => {
  return (
    <div className={cn(className, "flex flex-col justify-center")}>
      {title && <div className="text-lg">{title}</div>}
      {children}
    </div>
  )
}

export const FormActions: React.FC<{}> = ({ children }) => {
  return <div className="w-full flex justify-end space-x-4">{children}</div>
}
