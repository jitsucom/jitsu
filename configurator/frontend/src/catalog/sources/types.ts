import { ReactNode } from 'react';

type PrimitiveParameterTypeName =
  | 'string'
  | 'description'
  | 'int'
  | 'json'
  | 'javascript'
  | 'yaml'
  | 'password'
  | 'boolean'
  | 'dashDate'
  | 'isoUtcDate'
  | 'selection';

type ArrayParameterTypeName = `array/${PrimitiveParameterTypeName}`;

type ParameterTypeName = PrimitiveParameterTypeName | ArrayParameterTypeName;

type StringParameter = {
  /**
   * String with regexp that specifies the allowed values
   */
  pattern?: string;
};

type NumberParameter = {
  /**
   * Minimum allowed value of a numeric parameter
   */
  minimum?: number;
  /**
   * Maximum allowed value of a numeric parameter
   */
  maximum?: number;
};

type FieldsByType<T> = T extends 'string'
  ? StringParameter
  : T extends 'int'
  ? NumberParameter
  : {};

/**
 * Type of parameter
 */
export type ParameterType<
  T,
  N extends ParameterTypeName = ParameterTypeName
> = FieldsByType<N> & {
  /**
   * Unique name of the type
   */
  typeName: N;
  /**
   * Additional parameters (for selects - list of options)
   */
  data?: T;

  //not used / not implemented at the moment, reserved for future use
  fromString?: (str: string) => T;

  toString?: (t: T) => string;
};

export function hiddenValue<P, V extends number | string | bigint>(
  value: V | ((config: P) => V),
  hide?: (config: P) => boolean
): ConstantOrFunction<P, V> {
  if (!hide) {
    return undefined;
  } else {
    return (config) => {
      if (hide(config)) {
        return typeof value === 'function' ? value(config) : value;
      } else {
        return undefined;
      }
    };
  }
}

function assertIsPrimitiveParameterTypeName(
  typeName: ParameterTypeName,
  errorMsg?: string
): asserts typeName is PrimitiveParameterTypeName {
  if (typeName.startsWith('array/'))
    throw new Error(errorMsg || 'Primitive parameter assertion failed');
}

export function assertIsStringParameterType(
  parameterType: ParameterType<any, any>,
  errorMessage?: string
): asserts parameterType is ParameterType<unknown, 'string'> {
  if (parameterType.typeName !== 'string')
    throw new Error(errorMessage || '`string` parameter type assertion failed');
}

export function assertIsIntParameterType(
  parameterType: ParameterType<any, any>,
  errorMessage?: string
): asserts parameterType is ParameterType<unknown, 'int'> {
  if (parameterType.typeName !== 'int')
    throw new Error(errorMessage || '`int` parameter type assertion failed');
}

export const stringType: ParameterType<string, 'string'> = {
  typeName: 'string'
};

export const makeStringType = (
  pattern?: string
): ParameterType<string, 'string'> => {
  return pattern ? { ...stringType, pattern } : stringType;
};

export const descriptionType: ParameterType<string, 'description'> = {
  typeName: 'description'
};

export const intType: ParameterType<bigint, 'int'> = {
  typeName: 'int'
};

export const makeIntType = (options?: {
  minimum?: number;
  maximum?: number;
}): ParameterType<bigint, 'int'> => {
  const result: ParameterType<bigint, 'int'> = { ...intType };
  if (options)
    Object.entries(options).forEach(([key, value]) => (result[key] = value));
  return result;
};

export const jsonType: ParameterType<string, 'json'> = {
  typeName: 'json' as const
};

export const jsType: ParameterType<string, 'javascript'> = {
  typeName: 'javascript' as const
};

export const yamlType: ParameterType<string, 'yaml'> = {
  typeName: 'yaml' as const
};

export const passwordType: ParameterType<string, 'password'> = {
  typeName: 'password' as const
};

export const booleanType: ParameterType<boolean, 'boolean'> = {
  typeName: 'boolean' as const
};

export const arrayOf = <T>(param: ParameterType<T>): ParameterType<T[]> => {
  const typeName: ParameterTypeName = param.typeName;
  assertIsPrimitiveParameterTypeName(typeName);
  return {
    typeName: `array/${typeName}` as const
  };
};

/**
 * YYYY-MM-DD
 */
export const dashDateType: ParameterType<string> = {
  typeName: 'dashDate' as const
};

/**
 * ISO_8601 (https://en.wikipedia.org/wiki/ISO_8601) time
 */
export const isoUtcDateType: ParameterType<string> = {
  typeName: 'isoUtcDate' as const
};

export interface SelectOption {
  id: string;
  displayName: string;
}

export interface SelectOptionCollection {
  options: SelectOption[];
  /**
   * Maximum options allowed to be selected. Undefined means there's no limit in number of possible
   * selected fields
   */
  maxOptions?: number;
}

export const selectionType = (
  options: string[],
  maxOptions?: number
): ParameterType<SelectOptionCollection> => {
  return {
    data: {
      options: options.map((id) => ({ displayName: id, id: id })),
      maxOptions
    },
    typeName: 'selection' as const
  };
};

export const singleSelectionType = (
  options: string[]
): ParameterType<SelectOptionCollection> => {
  return selectionType(options, 1);
};

export type Function<P, V> = (param: P) => V;

export type ConstantOrFunction<P, V> = V | Function<P, V>;

export function asFunction<P, V>(p: ConstantOrFunction<P, V>): Function<P, V> {
  if (typeof p === 'function') {
    return p as Function<P, V>;
  } else {
    return (_) => p;
  }
}

/**
 * Validates the value. Returns `null` if the value is valid otherwise returns `undefined`.
 */
export type Validator = (value: any) => string | undefined;

export type Parameter = {
  /**
   * Display name (for UI)
   */
  displayName?: string;
  /**
   * Id (corresponds to key in yaml config)
   */
  id: string;
  /**
   * Type of parameter
   */
  type?: ParameterType<any>;

  /**
   * Default value (should be displayed by default)
   */
  defaultValue?: any;

  /**
   *  Flag describes required/optional nature of the field. IF empty - field is optional
   *  Either constant or function of current config
   */
  required?: ConstantOrFunction<any, any>;

  /**
   * Documentation
   */
  documentation?: ReactNode;

  /**
   * Either constant or function of current config (to be able to hide fields based on rules)
   *
   * If value is defined (!== undefined): field should be hidden and constant value
   * should be put to the form.
   *
   * WARNING: value could be  "" or null which is a valid defined value. Do not check it with if (constant),
   * use `constant !== undefined` to send a hidden value to backend. To conditionally omit the field completely
   * use `omitFieldRule` function.
   */
  constant?: ConstantOrFunction<any, any>;

  /**
   * Function of current config that shows whether to use field (render and send value) or not.
   */
  omitFieldRule?: (config: unknown) => boolean
};

export interface CollectionParameter extends Parameter {
  /**
   * If defined, should be applied only to specific collections
   * (see SourceConnector.collectionTypes)
   */
  applyOnlyTo?: string[] | string;
}

type SourceConnectorId =
  | 'facebook_marketing'
  | 'google_ads'
  | 'google_analytics'
  | 'google_play'
  | 'firebase'
  | 'redis'
  | 'amplitude'
  | `singer-${string}`
  | `airbyte-source-${string}`;
export interface SourceConnector {
  /**
   * Hints the source origin.
   * */
  protoType?: 'singer' | 'airbyte';
  /**
   * Enable collection Start Date parameter.
   * */
  isStartDateEnabled?: boolean;

  /**
   * If connector requires expert-level knowledge (such as JSON editing)
   *
   * Undefined means false
   */
  expertMode?: boolean;
  /**
   * Name of connector that should be displayed
   */
  displayName: string;
  /**
   * id of connector. Corresponds to 'type' node in event native config
   */
  id: SourceConnectorId;
  /**
   * SVG icon (please, no height/width params!)
   */
  pic: ReactNode;
  /**
   * Parameters of each collection
   */
  collectionParameters: CollectionParameter[];
  /**
   * Configuration parameters
   */
  configParameters: Parameter[];

  /**
   * `true` if need to additionally load `configParameters`
   */
  hasLoadableParameters?: boolean;

  /**
   * If collections are limited to certain names, list them here
   */
  collectionTypes: string[];

  /**
   * Collection templates
   */
  collectionTemplates?: CollectionTemplate[];

  /**
   * API Connector documentation
   */
  documentation?: ConnectorDocumentation;

  /**
   * If true, user won't be able to add new sources of this type 
   * yet it will be possible to edit the existing ones
   */
  deprecated?: boolean;
}

/**
 * Collection template: predefined configuratio for collections
 */
export interface CollectionTemplate {
  templateName: string;
  collectionName: string;
  config: any;
}

/**
 * Structured documentation for connector
 */
export type ConnectorDocumentation = {
  /**
   * Overview: just a few words about connector
   */
  overview: ReactNode;
  /**
   * Connection properties
   */
  connection: ReactNode;
};
export interface SingerTap {
  pic: ReactNode;
  displayName: string;
  tap: string;
  /**
   * Whether we consider this tap as stable and production ready
   */
  stable: boolean;
  /**
   * We have a native equivalent
   */
  hasNativeEquivalent: boolean;
  /**
   * If the tap uses legacy properties.json instead of catalog.json
   */
  legacyProperties?: boolean;
  /**
   * If tap defines it's own parameters instead of
   * default singer params
   */
  parameters?: Parameter[];
  /**
   * API Connector documentation
   */
  documentation?: ConnectorDocumentation;
  /**
   * Allows only editing the existing sources
   */
  deprecated?: boolean;
}

export interface AirbyteSource {
  pic: ReactNode;
  docker_image_name: `airbyte/source-${string}`;
  displayName: string;
  /**
   * Whether we consider this tap as stable and production ready
   */
  stable: boolean;
  /**
   * We have a native equivalent
   */
  hasNativeEquivalent?: boolean;
  /**
   * API Connector documentation
   */
  documentation?: ConnectorDocumentation;
}