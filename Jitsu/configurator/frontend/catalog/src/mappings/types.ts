import { ReactNode } from "react"

export type FielMappingAction = "move" | "remove" | "cast" | "constant"

export interface FieldMapping {
  src: string | null
  dst: string
  action: string
  /**
   * For action === cast only
   */
  type?: string

  /**
   * For action === constant only
   */
  value?: any
}

export interface DestinationConfigurationTemplate {
  displayName?: ReactNode
  tableNameTemplate?: string
  comment?: ReactNode
  keepUnmappedFields: boolean
  mappings: FieldMapping[]
}
