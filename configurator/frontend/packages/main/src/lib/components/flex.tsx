import * as React from "react"
import { CSSProperties } from "react"
/**
 * A set of components to implement flex-box layout.
 *
 * See https://css-tricks.com/snippets/css/a-guide-to-flexbox/ as
 * a main guid
 */

const aliases = {
  "left-to-right": "row",
  "right-to-left": "row-reverse",
  "top-to-bottom": "column",
  "bottom-to-top": "column-reverse",
}

type FlexDirection =
  | "row"
  | "row-reverse"
  | "column"
  | "column-reverse"
  | "bottom-to-top"
  | "top-to-bottom"
  | "right-to-left"
  | "left-to-right"
type FlexWrap = "nowrap" | "wrap" | "wrap-reverse"
type MainAlignment = "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"
type SecondaryItemsAlignment = "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
type SecondaryContentAlignment = "flex-start" | "flex-end" | "center" | "space-between" | "space-around"

function resolve(value: string, aliases: Record<string, string>, defaultValue: string) {
  if (value === null || value === undefined) {
    return defaultValue
  }
  return aliases[value] || value
}

type FlexContainerProps = {
  className?: string
  direction: FlexDirection
  wrap?: FlexWrap
  justifyContent?: MainAlignment
  alignItems?: SecondaryItemsAlignment
  alignContent?: SecondaryContentAlignment
  children: React.ReactNode
}

type FlexItemProps = {
  className?: string
  grow?: number
  alignSelf?: SecondaryItemsAlignment
  children: React.ReactNode
}

function removeNulls(map: Record<string, any>): Record<string, any> {
  let res = {}
  Object.entries(map).forEach(([key, val]) => {
    if (val !== null && val !== undefined) {
      res[key] = val
    }
  })
  return res
}

export function FlexContainer(props: FlexContainerProps) {
  let style: CSSProperties = {
    display: "flex",
    flexDirection: resolve(props.direction, aliases, null) as any,
    flexWrap: resolve(props.wrap, aliases, null) as any,
    justifyContent: resolve(props.justifyContent, aliases, null) as any,
    alignItems: resolve(props.alignItems, aliases, null) as any,
    alignContent: resolve(props.alignContent, aliases, null) as any,
  }
  return (
    <div className={props.className} style={removeNulls(style)}>
      {props.children}
    </div>
  )
}

export function FlexItem(props: FlexItemProps) {
  let style: CSSProperties = {
    //display: "inline-block"
  }
  return (
    <div className={props.className} style={removeNulls(style)}>
      {props.children}
    </div>
  )
}

const Flex = {
  Item: FlexItem,
  Container: FlexContainer,
}

export default Flex
