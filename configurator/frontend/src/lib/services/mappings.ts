export class FieldMappings {
  private readonly _keepUnmappedFields: boolean = true;
  private readonly _mappings: Mapping[] = [];

  constructor(mappings: Mapping[], keepUnmappedFields: boolean) {
    this._keepUnmappedFields = keepUnmappedFields;
    this._mappings = mappings;
  }

  get keepUnmappedFields(): boolean {
    return this._keepUnmappedFields;
  }

  get mappings(): Mapping[] {
    return this._mappings;
  }

  addMapping(mapping: Mapping) {
    this._mappings.push(mapping);
  }

  removeMapping(index) {
    this._mappings.splice(index, 1);
  }
}

export class Mapping {
  private _srcField: string;
  private _dstField: string;
  private _action: MappingAction;

  constructor(srcField: string, dstField: string, action: MappingAction) {
    this._srcField = srcField;
    this._dstField = dstField;
    this._action = action;
  }

  get srcField(): string {
    return this._srcField;
  }

  set srcField(val: string) {
    this._srcField = val;
  }

  set dstField(val: string) {
    this._dstField = val;
  }

  get dstField(): string {
    return this._dstField;
  }

  get action(): MappingAction {
    return this._action;
  }

  set action(action: MappingAction) {
    this._action = action;
  }
}

export class JsonPath {
  private _parts: string[] = [];

  constructor(path: string) {
    this._parts = path
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  }

  get parts(): string[] {
    return this._parts;
  }

  toString(): string {
    return '/' + this._parts.join('/');
  }
}

export type MappingAction = 'erase' | 'cast/int' | 'cast/double' | 'cast/date' | 'move';

const MAPPING_NAMES: Record<string, string> = {
  erase: 'Remove field',
  'cast/int': 'Cast to INT',
  'cast/double': 'Cast to DOUBLE',
  'cast/date': 'Cast to DATE',
  move: 'Move field'
};
export default MAPPING_NAMES;
