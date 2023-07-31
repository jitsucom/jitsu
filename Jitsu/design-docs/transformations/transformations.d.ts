
export type EventPayload = object;

export type TypedValue<V, T> = {
  value: T
  __jitsuT__: T
}

export type ProcessingContext = {
  /**
   * Id of the source orinating the event
   */
  sourceId: string
}

/**
 * Generic type for transformation result: tuple of table name and event data (array or single event)
 */
export type GenericTransformationResult<T> = [string, T];

/**
 * Canonical transformation result which is table + array of Event
 */
export type CanonicalTransformationResult = GenericTransformationResult<EventPayload[]>;

export type TransformationResult = CanonicalTransformationResult | GenericTransformationResult<EventPayload>


export type Transformation = (event: EventPayload, ctx: ProcessingContext) => TransformationResult;

//utility functions

export function toCanonical(result: TransformationResult): CanonicalTransformationResult;

/**
 * Generates transformation based on config. It's a test function which will not generate
 *
 */
export function generateTransformation(config: object): Transformation;

export type cast = {
  timestamp: (obj: any) => TypedValue<string, "Date">
}
