import { ReactNode } from 'react';

/**
 * Type of parameter
 */
export interface ParameterType<T> {
    /**
     * Unique name of the type
     */
    typeName: string
    /**
     * Additional parameters (for selects - list of options)
     */
    data?: T

    //not used / not implemented at the moment, reserved for future use
    fromString?: (str: string) => T

    toString?: (t: T) => string
}

export const stringType: ParameterType<string> = {
  typeName: 'string'
}

export const intType: ParameterType<bigint> = {
  typeName: 'int'
}

export const jsonType: ParameterType<string> = {
  typeName: 'json'
}

export const yamlType: ParameterType<string> = {
  typeName: 'yaml'
}

/**
 * YYYY-MM-DD
 */
export const dashDateType: ParameterType<string> = {
  typeName: 'dashDate'
}

/**
 * ISO_8601 (https://en.wikipedia.org/wiki/ISO_8601) time
 */
export const isoUtcDateType: ParameterType<string> = {
  typeName: 'isoUtcDate'
}

export interface SelectOption {
    id: string
    displayName: string
}

export interface SelectOptionCollection {
    options: SelectOption[]
    /**
     * Maximum options allowed to be selected. Undefined means there's no limit in number of possible
     * selected fields
     */
    maxOptions?: number
}

export const selectionType = (options: string[], maxOptions?: number): ParameterType<SelectOptionCollection>  => {
  return {
    data: {
      options: options.map((id) => ({ displayName: id, id: id })),
      maxOptions
    },
    typeName: 'selection'
  }
}

export type Parameter = {
    /**
     * Display name (for UI)
     */
    displayName?: string
    /**
     * Id (corresponds to key in yaml config)
     */
    id: string
    /**
     * Type of parameter
     */
    type?: ParameterType<any>

    /**
     * Default value (should be displayed by default)
     */
    defaultValue?: any

    /**
     *  Flag describes required/optional nature of the field. IF empty - field is optional
     */
    required?: boolean

    /**
     * Documentation
     */
    documentation?: ReactNode

    /**
     * If not undefined: the parameter should not be configurable at all (hidden from UI) and
     * it's value should be always constant
     */
    constant?: any
}

export interface CollectionParameter extends Parameter {
    /**
     * If defined, should be applied only to specific collections
     * (see SourceConnector.collectionTypes)
     */
    applyOnlyTo?: string[] | string
}

export interface SourceConnector {
    /**
     * Is it singer source or not, optional parameter.
     * */
    isSingerType?: boolean;
    /**
     * Name of connector that should be displayed
     */
    displayName: string
    /**
     * id of connector. Corresponds to 'type' node in event native config
     */
    id: string
    /**
     * SVG icon (please, no height/width params!)
     */
    pic: ReactNode,
    /**
     * Parameters of each collection
     */
    collectionParameters: CollectionParameter[]
    /**
     * Configuration parameters
     */
    configParameters: Parameter[]

    /**
     * If collections are limited to certain names, list them here
     */
    collectionTypes: string[]

    description?: ReactNode
}
