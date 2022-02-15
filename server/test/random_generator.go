package test

import (
	"github.com/jitsucom/jitsu/server/random"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"math/rand"
)

//UniqueIDIface is used for preventing cycle dependency
type UniqueIDIface interface {
	Set(obj map[string]interface{}, id string) error
}

//RandomGenerator is a random data generator
//it is suggested to use 1 RandomGenerator per 1 table
type RandomGenerator struct {
	uniqueID UniqueIDIface
}

func NewRandomGenerator(uniqueID UniqueIDIface) *RandomGenerator {
	return &RandomGenerator{uniqueID: uniqueID}
}

func (rg *RandomGenerator) GenerateData(columns int, rows int) ([]map[string]interface{}, error) {
	return rg.GenerateDataWithUniqueIDs(columns, rows, rows)
}

//GenerateDataWithUniqueIDs returns array of objects with length=rows. The amount of objects with uniqueID = uniqueCount
func (rg *RandomGenerator) GenerateDataWithUniqueIDs(columns int, rows int, uniqueCount int) ([]map[string]interface{}, error) {
	ids := rg.generateIDs(rows, uniqueCount)
	result := make([]map[string]interface{}, 0, rows)

	columnNamesCache := make([]string, 0, columns)
	columnTypesCache := make(map[string]int, columns)
	for i := 0; i < columns; i++ {
		name := random.String(rand.Intn(10) + 1)
		columnNamesCache = append(columnNamesCache, name)
		columnTypesCache[name] = rand.Intn(8)
	}

	for i := 0; i < rows; i++ {
		obj := map[string]interface{}{timestamp.Key: timestamp.NowUTC()}
		for j := 0; j < columns; j++ {
			columnName := columnNamesCache[j]
			columnType := columnTypesCache[columnName]
			obj[columnName] = rg.getRandomValue(columnType)
		}

		if err := rg.uniqueID.Set(obj, ids[i]); err != nil {
			return nil, err
		}

		result = append(result, obj)
	}

	return result, nil
}

//generateIDs generates IDs count == len objects
//ensures duplicateCount ids are non unique
func (rg *RandomGenerator) generateIDs(objects, uniqueCount int) []string {
	ids := make([]string, 0, objects)
	nextIDForDuplicate := 0
	for i := 0; i < objects; i++ {
		if uniqueCount > 0 {
			ids = append(ids, uuid.New())
			uniqueCount--
		} else {
			if nextIDForDuplicate >= i {
				nextIDForDuplicate = 0
			}
			ids = append(ids, ids[nextIDForDuplicate])
			nextIDForDuplicate++
		}

	}

	return ids
}

func (rg *RandomGenerator) getRandomValue(columnType int) interface{} {
	switch columnType {
	case 0:
		return random.String(rand.Intn(60))
	case 1:
		return rand.Int()
	case 2:
		return rand.Float64()
	case 3:
		ar := []string{}
		for i := 0; i < 5; i++ {
			ar = append(ar, random.String(rand.Intn(10)))
		}
		return ar
	case 4:
		ar := []int{}
		for i := 0; i < 5; i++ {
			ar = append(ar, rand.Int())
		}
		return ar
	case 5:
		ar := []float64{}
		for i := 0; i < 5; i++ {
			ar = append(ar, rand.Float64())
		}
		return ar
	case 6:
		return timestamp.Now()
	case 7:
		return timestamp.NowUTC()
	default:
		return nil
	}
}
