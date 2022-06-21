// @Libs
import * as React from "react"
import { Form, Input } from "antd"
import cn from "classnames"
import get from "lodash/get"
// @Components
import { FloatingLabel } from "ui/components/FloatingLabelInput/FloatingLabel"
// @Types
import { Rule } from "antd/lib/form"
import { SizeType } from "antd/lib/config-provider/SizeContext"

export interface Props {
  className?: string
  wrapClassName?: string
  name: any,
  formName: string
  floatingLabelText: React.ReactNode
  rules?: Rule[]
  size?: SizeType
  prefix?: React.ReactNode
  inputType?:
    | "button"
    | "checkbox"
    | "file"
    | "hidden"
    | "image"
    | "password"
    | "radio"
    | "reset"
    | "submit"
    | "text"
    | "email"
    | "range"
    | "search"
    | "tel"
    | "url"
}

const FloatingLabelInputComponent = ({
  formName,
  name,
  rules,
  floatingLabelText,
  prefix,
  inputType = "text",
  size,
  className,
  wrapClassName,
}: Props) => {
  return (
    <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => get(prevValues, name) !== get(currentValues, name)}>
      {/* ToDo: getInternalHooks what is it??? */}
      {({ getFieldValue }) => (
        <Form.Item name={name} rules={rules} className={cn(wrapClassName)}>
          <Input
            className={cn("with-floating-label", className)}
            prefix={prefix}
            suffix={
              <FloatingLabel
                className={prefix && "with-prefix"}
                size={size}
                hasValue={getFieldValue(name)}
                htmlFor={`${formName}_${name}`}
                render={floatingLabelText}
              />
            }
            type={inputType}
            size={size}
          />
        </Form.Item>
      )}
    </Form.Item>
  )
}

FloatingLabelInputComponent.displayName = "FloatingLabelInput"

export const FloatingLabelInput = React.memo(FloatingLabelInputComponent)
