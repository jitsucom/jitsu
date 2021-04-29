declare type MappingAction = 'remove' | 'cast' | 'move' | 'constant';

declare interface MappingRow {
  _srcField: string;
  _dstField: string;
  _action: MappingAction;
}

declare interface Mapping {
  _mapping: MappingRow[];
  _keepUnmappedFields: boolean;
}
