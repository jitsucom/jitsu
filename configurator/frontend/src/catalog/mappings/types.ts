export type FielMappingAction = 'move' | 'remove' | 'cast' | 'constant';

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

export interface Mapping {
  tableNameTemplate?: string;
  comment?: React.ReactNode;
  keepUnmappedFields: boolean
  mappings: FieldMapping[]
}
