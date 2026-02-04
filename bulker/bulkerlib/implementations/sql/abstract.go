package sql

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	types2 "github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

// TODO: check whether COPY is transactional ?
// TODO: pk conflict on Redshift file storage ?

const unmappedDataColumn = "_unmapped_data"

type AbstractSQLStream struct {
	id                  string
	sqlAdapter          SQLAdapter
	stringifyObjects    bool
	mode                bulker.BulkMode
	options             bulker.StreamOptions
	tableName           string
	namespace           string
	nameTransformer     func(string) string
	nameTransformerUsed bool
	merge               bool
	mergeWindow         int
	omitNils            bool
	schemaFreeze        bool
	maxColumnsCount     int
	schemaFromOptions   *Table
	notFlatteningKeys   types2.Set[string]

	state    bulker.State
	inited   bool
	lastPing time.Time

	existingTable *Table

	customTypes     types.SQLTypes
	pkColumns       jsonorder.OrderedSet[string]
	pkColumnsArrays []string
	timestampColumn string

	unmappedDataColumn string

	// initial columns count in the destination table
	initialColumnsCount int
	// columns added to the destination table during processing.
	addedColumns int

	startTime time.Time
}

func newAbstractStream(id string, p SQLAdapter, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (*AbstractSQLStream, error) {
	ps := AbstractSQLStream{id: id, sqlAdapter: p, stringifyObjects: p.StringifyObjects(), tableName: p.TableName(tableName), mode: mode}
	ps.options = bulker.StreamOptions{}
	for _, option := range streamOptions {
		ps.options.Add(option)
	}
	if bulker.ToSameCaseOption.Get(&ps.options) {
		if p.Type() == SnowflakeBulkerTypeId {
			ps.nameTransformer = strings.ToUpper
		} else {
			ps.nameTransformer = strings.ToLower
		}
		ps.nameTransformerUsed = true
		ps.tableName = p.TableName(ps.nameTransformer(tableName))
	} else {
		ps.nameTransformer = func(s string) string { return s }
	}
	ps.merge = bulker.DeduplicateOption.Get(&ps.options)
	pkColumns := bulker.PrimaryKeyOption.Get(&ps.options)
	if ps.merge && pkColumns.Empty() {
		return nil, fmt.Errorf("MergeRows option requires primary key in the destination table. Please provide WithPrimaryKey option")
	}
	if ps.merge {
		ps.mergeWindow = DeduplicateWindow.Get(&ps.options)
	}

	var customFields = ColumnTypesOption.Get(&ps.options)
	ps.pkColumns = pkColumns.Map(ps.nameTransformer).Map(p.ColumnName)
	ps.pkColumnsArrays = ps.pkColumns.ToSlice()
	ps.timestampColumn = bulker.TimestampOption.Get(&ps.options)
	if ps.timestampColumn != "" {
		ps.timestampColumn = p.ColumnName(ps.nameTransformer(ps.timestampColumn))
	}
	ps.namespace = bulker.NamespaceOption.Get(&ps.options)
	if ps.namespace != "" {
		ps.namespace = p.NamespaceName(ps.nameTransformer(ps.namespace))
	}
	ps.omitNils = OmitNilsOption.Get(&ps.options)
	ps.schemaFreeze = SchemaFreezeOption.Get(&ps.options)
	ps.maxColumnsCount = MaxColumnsCount.Get(&ps.options)

	schema := bulker.SchemaOption.Get(&ps.options)
	if !schema.IsEmpty() {
		ps.schemaFromOptions = ps.sqlAdapter.TableHelper().MapSchema(ps.sqlAdapter, schema, ps.nameTransformer)
		notFlatteningKeys := types2.NewSet[string]()
		for _, field := range schema.Fields {
			notFlatteningKeys.Put(field.Name)
		}
		ps.notFlatteningKeys = notFlatteningKeys
	}

	ps.unmappedDataColumn = p.ColumnName(ps.nameTransformer(unmappedDataColumn))

	ps.state = bulker.State{Status: bulker.Active, Mode: mode, Representation: RepresentationTable{
		Name: ps.tableName,
	}}
	ps.customTypes = customFields
	ps.startTime = time.Now()
	return &ps, nil
}

func (ps *AbstractSQLStream) preprocess(object types.Object, skipTypeHints bool) (*Table, types.Object, error) {
	if ps.state.Status != bulker.Active {
		return nil, nil, fmt.Errorf("stream is not active. Status: %s", ps.state.Status)
	}

	_ = object.Delete("JITSU_TABLE_NAME")
	notFlatKeys := ps.notFlatteningKeys
	var sqlTypesHints types.SQLTypes
	var err error
	if !skipTypeHints {
		sqlTypesHints, err = extractSQLTypesHints(object)
		if err != nil {
			return nil, nil, err
		}
	}
	if len(ps.customTypes) > 0 {
		if sqlTypesHints == nil {
			sqlTypesHints = types.SQLTypes{}
		}
		for k, v := range ps.customTypes {
			sqlTypesHints[k] = v
		}
	}
	if len(sqlTypesHints) > 0 {
		notFlatKeys = types2.NewSet[string]()
		for key := range sqlTypesHints {
			notFlatKeys.Put(key)
		}
		notFlatKeys.PutSet(ps.notFlatteningKeys)
	}
	processedObject, table, err := ps.mapForDwh(object, notFlatKeys, sqlTypesHints)
	if err != nil {
		return nil, nil, err
	}
	ps.state.ProcessedRows++
	return table, processedObject, nil
}

type DWHEnvelope struct {
	sqlAdapter      SQLAdapter
	flattenedObject types.Object
	table           *Table
	sqlTypesHints   types.SQLTypes
}

func (dwh *DWHEnvelope) set(fieldName string, value any) error {
	if fieldName == "" {
		fieldName = "_unnamed"
	}
	colName := dwh.sqlAdapter.ColumnName(fieldName)

	dwh.flattenedObject.Set(colName, value)
	field, err := ResolveType(fieldName, value, dwh.sqlTypesHints)
	if err != nil {
		return err
	}
	suggestedSQLType, ok := field.GetSuggestedSQLType()
	if ok {
		dt, ok := dwh.sqlAdapter.GetDataType(suggestedSQLType.Type)
		if ok {
			suggestedSQLType.DataType = dt
		}
		dwh.table.Columns.Set(colName, suggestedSQLType)
	} else {
		//map Jitsu type -> SQL type
		sqlType, ok := dwh.sqlAdapter.GetSQLType(field.GetType())
		if ok {
			dwh.table.Columns.Set(colName, types.SQLColumn{DataType: field.GetType(), Type: sqlType, New: true})
		} else {
			logging.SystemErrorf("Unknown column type %s mapping for %s", field.GetType(), dwh.sqlAdapter.Type())
		}
	}
	return nil
}

func (ps *AbstractSQLStream) mapForDwh(object types.Object, notFlatteningKeys types2.Set[string], sqlTypesHints types.SQLTypes) (types.Object, *Table, error) {
	flattenMap := types.NewObject(ps.existingTable.ColumnsCount() + 1)
	table := &Table{
		Name:            ps.tableName,
		Namespace:       ps.namespace,
		Columns:         NewColumns(ps.existingTable.ColumnsCount() + 1),
		PKFields:        ps.pkColumns,
		TimestampColumn: ps.timestampColumn,
	}
	dwhEnvelope := &DWHEnvelope{
		sqlAdapter:      ps.sqlAdapter,
		flattenedObject: flattenMap,
		table:           table,
		sqlTypesHints:   sqlTypesHints,
	}

	err := ps._mapForDwh("", object, dwhEnvelope, notFlatteningKeys)
	if err != nil {
		return nil, nil, err
	}
	return flattenMap, table, nil
}

// recursive function for flatten key (if value is inner object -> recursion call)
// Reformat key
func (ps *AbstractSQLStream) _mapForDwh(key string, value types.Object, dwhEnvelope *DWHEnvelope, notFlatteningKeys types2.Set[string]) error {
	if notFlatteningKeys != nil {
		if _, ok := notFlatteningKeys[key]; ok {
			if ps.stringifyObjects {
				// if there is sql type hint for nested object - we don't flatten it.
				// Instead, we marshal it to json string hoping that database cast function will do the job
				b, err := jsonorder.MarshalToString(value)
				if err != nil {
					return fmt.Errorf("error marshaling json object with key %s: %v", key, err)
				}
				err = dwhEnvelope.set(key, b)
				if err != nil {
					return err
				}

			} else {
				err := dwhEnvelope.set(key, types.ObjectToMap(value))
				if err != nil {
					return err
				}
			}
			return nil
		}
	}
	for el := value.Front(); el != nil; el = el.Next() {
		var newKey string
		if key != "" {
			if ps.nameTransformerUsed {
				newKey = key + "_" + ps.nameTransformer(el.Key)
			} else {
				newKey = key + "_" + el.Key
			}
		} else if ps.nameTransformerUsed {
			newKey = ps.nameTransformer(el.Key)
		} else {
			newKey = el.Key
		}
		elv := el.Value
		if elv == nil {
			if !ps.omitNils {
				err := dwhEnvelope.set(newKey, elv)
				if err != nil {
					return err
				}
			} else {
				continue
			}
		} else {
			switch o := elv.(type) {
			case string:
				var v any = o
				ts, ok := types.ReformatTimeValue(o, false)
				if ok {
					v = ts
				}
				err := dwhEnvelope.set(newKey, v)
				if err != nil {
					return err
				}
			case json.Number:
				err := dwhEnvelope.set(newKey, types.ReformatJSONNumberValue(o))
				if err != nil {
					return err
				}
			case bool:
				err := dwhEnvelope.set(newKey, o)
				if err != nil {
					return err
				}
			case types.Object:
				if err := ps._mapForDwh(newKey, o, dwhEnvelope, notFlatteningKeys); err != nil {
					return err
				}
			case []any:
				if ps.stringifyObjects {
					b, err := jsonorder.Marshal(elv)
					if err != nil {
						return fmt.Errorf("error marshaling array with key %s: %v", key, err)
					}
					err = dwhEnvelope.set(newKey, string(b))
					if err != nil {
						return err
					}
				} else {
					err := dwhEnvelope.set(newKey, utils.ArrayMap(o, func(obj any) any {
						o, ok := obj.(types.Object)
						if ok {
							return types.ObjectToMap(o)
						}
						return obj
					}))
					if err != nil {
						return err
					}
				}
			case []types.Object:
				// not really the case. because it is hiding behind []any type
				if ps.stringifyObjects {
					b, err := jsonorder.Marshal(elv)
					if err != nil {
						return fmt.Errorf("error marshaling array with key %s: %v", key, err)
					}
					err = dwhEnvelope.set(newKey, string(b))
					if err != nil {
						return err
					}
				} else {
					err := dwhEnvelope.set(newKey, utils.ArrayMap(o, func(obj types.Object) map[string]any {
						return types.ObjectToMap(obj)
					}))
					if err != nil {
						return err
					}
				}
			case int, int64, float64, time.Time:
				err := dwhEnvelope.set(newKey, o)
				if err != nil {
					return err
				}
			default:
				// just in case. but we never should reach this point
				k := reflect.TypeOf(elv).Kind()
				switch k {
				case reflect.Slice, reflect.Array:
					if ps.stringifyObjects {
						b, err := jsonorder.Marshal(elv)
						if err != nil {
							return fmt.Errorf("error marshaling array with key %s: %v", key, err)
						}
						err = dwhEnvelope.set(newKey, string(b))
						if err != nil {
							return err
						}
					} else {
						err := dwhEnvelope.set(newKey, elv)
						if err != nil {
							return err
						}
					}
				case reflect.Map:
					return fmt.Errorf("flattener doesn't support map. Object is required")
				default:
					err := dwhEnvelope.set(newKey, elv)
					if err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func (ps *AbstractSQLStream) postConsume(err error) error {
	if err != nil {
		ps.state.ErrorRowIndex = ps.state.ProcessedRows
		ps.state.SetError(err)
		return err
	} else {
		ps.state.SuccessfulRows++
	}
	return nil
}

func (ps *AbstractSQLStream) postComplete(err error) (bulker.State, error) {
	if err != nil {
		ps.state.SetError(err)
		ps.state.Status = bulker.Failed
	} else {
		ps.state.Status = bulker.Completed
	}
	if ps.state.Representation == nil {
		ps.updateRepresentationTable(&Table{
			Name: ps.tableName,
		})
	}
	return ps.state, err
}

func (ps *AbstractSQLStream) init(ctx context.Context) error {
	ctx1, cancel := context.WithTimeout(ctx, time.Second*290)
	defer cancel()
	if time.Since(ps.lastPing) > 5*time.Minute {
		if err := ps.sqlAdapter.Ping(ctx1); err != nil {
			return err
		}
		ps.lastPing = time.Now()
	}
	if ps.inited {
		return nil
	}
	//setup required db object like 'schema' or 'dataset' if doesn't exist
	err := ps.sqlAdapter.InitDatabase(ctx1)
	if err != nil {
		return err
	}
	ps.inited = true
	return nil
}

// adjustTableColumnTypes modify currentTable with extra new columns from desiredTable if such exists
// if some column already exists in the database, no problems if its DataType is castable to DataType of existing column
// if some new column is being added but with different DataTypes - type of this column will be changed to a common ancestor type
// object values that can't be casted will be added to '_unmaped_data' column of JSON type as an json object
// returns true if new column was added to the currentTable as a result of this function call
func (ps *AbstractSQLStream) adjustTableColumnTypes(currentTable, existingTable, desiredTable *Table, values types.Object) bool {
	columnsAdded := 0
	current := currentTable.Columns
	unmappedObj := map[string]any{}
	exists := existingTable.Exists()
	for el := desiredTable.Columns.Front(); el != nil; el = el.Next() {
		name := el.Key
		newCol := el.Value
		var existingCol types.SQLColumn
		ok := false
		if exists {
			existingCol, ok = existingTable.Columns.Get(name)
		}
		if !ok {
			existingCol, ok = current.Get(name)
			if !ok {
				if ps.schemaFreeze || ps.initialColumnsCount+ps.addedColumns+columnsAdded >= ps.maxColumnsCount {
					// when schemaFreeze=true all new columns values go to _unmapped_data
					if values != nil {
						v, ok := values.Get(name)
						if ok {
							unmappedObj[name] = v
						}
						values.Delete(name)
					}
					continue
				} else {
					// column doesn't exist in database and in current batch - adding as New
					if !newCol.Override && !newCol.Important {
						newCol.New = true
					}
					current.Set(name, newCol)
					columnsAdded++
					continue
				}
			}
		} else {
			current.Set(name, existingCol)
		}
		if existingCol.DataType == newCol.DataType {
			continue
		}
		if (newCol.Override || newCol.Important) && existingCol.New {
			//if column sql type is overridden by user - leave it this way
			current.Set(name, newCol)
			continue
		}
		// if column exists in db (existingTable) or in current batch (currentTable)
		if existingCol.Type != "" {
			// column exists in database or type is forced by Schema option or __sql_type hint
			// check if its DataType is castable to DataType of existing column
			if !existingCol.New || existingCol.Override || existingCol.Important {
				if values != nil {
					v, ok := values.Get(name)
					if ok && v != nil {
						if types.IsConvertible(newCol.DataType, existingCol.DataType) {
							newVal, _, err := types.Convert(existingCol.DataType, v)
							if err != nil {
								//logging.Warnf("Can't convert '%s' value '%v' from %s to %s: %v", name, values[name], newCol.DataType.String(), existingCol.DataType.String(), err)
								unmappedObj[name] = v
								//current.Delete(name)
								values.Delete(name)
								continue
							} else {
								//logging.Infof("Converted '%s' value '%v' from %s to %s: %v", name, values[name], newCol.DataType.String(), existingCol.DataType.String(), newVal)
								values.Set(name, newVal)
							}
						} else {
							//logging.Warnf("Can't convert '%s' value '%v' from %s to %s", name, values[name], newCol.DataType.String(), existingCol.DataType.String())
							unmappedObj[name] = v
							//current.Delete(name)
							values.Delete(name)
							continue
						}
					}
				}
			} else {
				// column exists only in current batch - we have chance to change new column type to common ancestor
				converted := false
				//special case: if existing column is timestamp and new is DATE string - leave timestamp
				if existingCol.DataType == types.TIMESTAMP && newCol.DataType == types.STRING {
					v, ok := values.Get(name)
					if ok {
						ts, ok, _ := types.Convert(types.TIMESTAMP, v)
						if ok {
							converted = true
							values.Set(name, ts)
						}
					}
				}
				if !converted {
					common := types.GetCommonAncestorType(existingCol.DataType, newCol.DataType)
					if common != existingCol.DataType {
						//logging.Warnf("Changed '%s' type from %s to %s because of %s", name, existingCol.DataType.String(), common.String(), newCol.DataType.String())
						sqlType, ok := ps.sqlAdapter.GetSQLType(common)
						if ok {
							existingCol.DataType = common
							existingCol.Type = sqlType
							current.Set(name, existingCol)
						} else {
							logging.SystemErrorf("Unknown column type %s mapping for %s", common, ps.sqlAdapter.Type())
						}
					}
				}
			}
		}
	}
	if len(unmappedObj) > 0 {
		var existingCol types.SQLColumn
		ok := false
		if exists {
			existingCol, ok = existingTable.Columns.Get(ps.unmappedDataColumn)
		}
		if !ok {
			jsonSQLType, _ := ps.sqlAdapter.GetSQLType(types.JSON)
			added := current.SetIfAbsent(ps.unmappedDataColumn, types.SQLColumn{DataType: types.JSON, Type: jsonSQLType})
			if added {
				columnsAdded++
			}
		} else {
			current.Set(ps.unmappedDataColumn, existingCol)
		}
		if ps.sqlAdapter.StringifyObjects() {
			b, _ := jsoniter.Marshal(unmappedObj)
			values.Set(ps.unmappedDataColumn, string(b))
		} else {
			values.Set(ps.unmappedDataColumn, unmappedObj)
		}
	}
	ps.addedColumns += columnsAdded
	return columnsAdded > 0
}

func (ps *AbstractSQLStream) updateRepresentationTable(table *Table) {
	if ps.state.Representation == nil ||
		ps.state.Representation.(RepresentationTable).Name != table.Name ||
		ps.state.Representation.(RepresentationTable).Schema.Len() != table.ColumnsCount() {
		ps.state.Representation = RepresentationTable{
			Name:             table.Name,
			TargetName:       ps.tableName,
			Schema:           table.ToSimpleMap(),
			PrimaryKeyFields: table.GetPKFields(),
			PrimaryKeyName:   table.PrimaryKeyName,
			Temporary:        table.Temporary,
		}
	}
}

type RepresentationTable struct {
	Name             string      `json:"name"`
	TargetName       string      `json:"targetName,omitempty"`
	Schema           types2.Json `json:"schema"`
	PrimaryKeyFields []string    `json:"primaryKeyFields,omitempty"`
	PrimaryKeyName   string      `json:"primaryKeyName,omitempty"`
	Temporary        bool        `json:"temporary,omitempty"`
}
