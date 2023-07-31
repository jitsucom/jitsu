package events

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const (
	batchKey = "batch"

	screenKey = "screen"

	messageIDKey = "messageId"
)

var malformedSegmentBatch = errors.New("malformed Segment body 'batch' type. Expected array of objects")

type ParsingError struct {
	LimitedPayload []byte
	Err            error
}

func parsingError(payload []byte, err error) *ParsingError {
	return &ParsingError{Err: err, LimitedPayload: payload}
}

//Parser is used for parsing income HTTP event body
type Parser interface {
	ParseEventsBody(c *gin.Context) ([]Event, *ParsingError)
}

//jitsuParser parses Jitsu events
type jitsuParser struct {
	maxEventSize           int
	maxCachedEventsErrSize int
}

//NewJitsuParser returns jitsuParser
func NewJitsuParser(maxEventSize, maxCachedEventsErrSize int) Parser {
	return &jitsuParser{maxEventSize: maxEventSize, maxCachedEventsErrSize: maxCachedEventsErrSize}
}

//ParseEventsBody parses HTTP body and returns Event objects or err if occurred
//unwraps template events if exists
func (jp *jitsuParser) ParseEventsBody(c *gin.Context) ([]Event, *ParsingError) {
	body, decoder, err := readBytes(c.Request.Body)
	if err != nil {
		return nil, parsingError(nil, err)
	}

	maxCachedEventsErrSize := jp.maxCachedEventsErrSize
	if len(body) < jp.maxCachedEventsErrSize {
		maxCachedEventsErrSize = len(body)
	}

	switch body[0] {
	case '{':
		if len(body) > jp.maxEventSize {
			return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("Event size %d exceeds limit: %d", len(body), jp.maxEventSize))
		}
		event := Event{}
		if err := decoder.Decode(&event); err != nil {
			return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("error parsing HTTP body: %v", err))
		}

		eventsArray, ok := jp.parseTemplateEvents(event)
		if ok {
			return eventsArray, nil
		}

		return []Event{event}, nil
	case '[':
		inputEvents := []Event{}
		if err := decoder.Decode(&inputEvents); err != nil {
			return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("error parsing HTTP body: %v", err))
		}
		if len(inputEvents) > 0 && len(body) > jp.maxEventSize*len(inputEvents) {
			return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("Size of one of events exceeds limit: %d", jp.maxEventSize))
		}
		return inputEvents, nil
	default:
		return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("malformed JSON body begins with: %q", string(body[0])))
	}
}

//parseTemplateEvents parses
// {template : {}, events: [{},{}]} structure
//return false if event doesn't have this structure
func (jp *jitsuParser) parseTemplateEvents(event Event) ([]Event, bool) {
	//check 'template' and 'events' in event
	eventTemplateIface, ok := event["template"]
	if !ok {
		return nil, false
	}

	partialEventsIface, ok := event["events"]
	if !ok {
		return nil, false
	}

	partialEventsIfaces, ok := partialEventsIface.([]interface{})
	if !ok {
		return nil, false
	}

	eventTemplate, ok := eventTemplateIface.(map[string]interface{})
	if !ok {
		return nil, false
	}

	var completeEvents []Event
	for _, partialEventIface := range partialEventsIfaces {
		partialEvent, ok := partialEventIface.(map[string]interface{})
		if !ok {
			return nil, false
		}

		for k, v := range eventTemplate {
			vMap, ok := v.(map[string]interface{})
			if ok {
				//prevent maps with the same pointer in different events
				partialEvent[k] = maputils.CopyMap(vMap)
			} else {
				partialEvent[k] = v
			}
		}

		completeEvents = append(completeEvents, partialEvent)
	}

	return completeEvents, true
}

//segmentParser parses Segment compatibility API events into JS SDK 2.0 and an old structure (compat=true)
type segmentParser struct {
	globalUniqueID *identifiers.UniqueID
	mapper         Mapper

	timeZone      jsonutils.JSONPath
	localTzOffset jsonutils.JSONPath

	screenWidth      jsonutils.JSONPath
	screenHeight     jsonutils.JSONPath
	screenResolution jsonutils.JSONPath

	maxEventSize           int
	maxCachedEventsErrSize int
}

//NewSegmentParser returns configured Segment Parser for SDK 2.0 data structures
func NewSegmentParser(mapper Mapper, globalUniqueID *identifiers.UniqueID, maxEventSize, maxCachedEventsErrSize int) Parser {
	return &segmentParser{
		globalUniqueID: globalUniqueID,
		mapper:         mapper,

		timeZone:      jsonutils.NewJSONPath("/timezone"),
		localTzOffset: jsonutils.NewJSONPath("/local_tz_offset"),

		screenWidth:      jsonutils.NewJSONPath("/screen/width"),
		screenHeight:     jsonutils.NewJSONPath("/screen/height"),
		screenResolution: jsonutils.NewJSONPath("/screen_resolution"),

		maxEventSize:           maxEventSize,
		maxCachedEventsErrSize: maxCachedEventsErrSize,
	}
}

//NewSegmentCompatParser returns configured Segment Parser for old Jitsu data structures
func NewSegmentCompatParser(mapper Mapper, globalUniqueID *identifiers.UniqueID, maxEventSize, maxCachedEventsErrSize int) Parser {
	return &segmentParser{
		globalUniqueID: globalUniqueID,
		mapper:         mapper,

		timeZone:      jsonutils.NewJSONPath("/timezone"),
		localTzOffset: jsonutils.NewJSONPath("/eventn_ctx/local_tz_offset"),

		screenWidth:      jsonutils.NewJSONPath("/screen/width"),
		screenHeight:     jsonutils.NewJSONPath("/screen/height"),
		screenResolution: jsonutils.NewJSONPath("/eventn_ctx/screen_resolution"),

		maxEventSize:           maxEventSize,
		maxCachedEventsErrSize: maxCachedEventsErrSize,
	}
}

//ParseEventsBody extracts batch events from HTTP body
//maps them into Jitsu format
//returns array of events or error if occurred
func (sp *segmentParser) ParseEventsBody(c *gin.Context) ([]Event, *ParsingError) {
	inputEvents, parsingErr := sp.parseSegmentBody(c.Request.Body)
	if parsingErr != nil {
		return nil, parsingErr
	}

	var resultEvents []Event
	for _, input := range inputEvents {
		mapped, err := sp.mapper.Map(input)
		if err != nil {
			return nil, parsingError(nil, err)
		}

		//timezone
		tz, ok := sp.timeZone.GetAndRemove(mapped)
		if ok {
			l, err := time.LoadLocation(fmt.Sprint(tz))
			if err == nil {
				_, offsetSeconds := timestamp.Now().In(l).Zone()
				sp.localTzOffset.Set(mapped, (time.Second * time.Duration(offsetSeconds)).Minutes())
			}
		}

		//screen resolution
		width, widthOk := sp.screenWidth.Get(mapped)
		height, heightOk := sp.screenHeight.Get(mapped)

		if widthOk && heightOk {
			sp.screenResolution.Set(mapped, fmt.Sprintf("%vx%v", width, height))
			delete(mapped, screenKey)
		}

		//unique identifier
		messageID, ok := mapped[messageIDKey]
		if ok {
			err := sp.globalUniqueID.Set(mapped, fmt.Sprint(messageID))
			if err == nil {
				delete(mapped, messageIDKey)
			}
		}

		resultEvents = append(resultEvents, mapped)
	}

	return resultEvents, nil
}

//parseSegmentBody parses input body
//returns objects array if batch field exists in body
//or returns an array with single element
func (sp *segmentParser) parseSegmentBody(requestBody io.ReadCloser) ([]map[string]interface{}, *ParsingError) {
	body, decoder, err := readBytes(requestBody)
	if err != nil {
		return nil, parsingError(nil, err)
	}

	maxCachedEventsErrSize := sp.maxCachedEventsErrSize
	if len(body) < sp.maxCachedEventsErrSize {
		maxCachedEventsErrSize = len(body)
	}

	inputEvent := map[string]interface{}{}
	if err := decoder.Decode(&inputEvent); err != nil {
		return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("error parsing HTTP body: %v", err))
	}

	batchPayload, ok := inputEvent[batchKey]
	if !ok {
		if len(body) > sp.maxEventSize {
			return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("Event size %d exceeds limit: %d", len(body), sp.maxEventSize))
		}
		//isn't batch request
		return []map[string]interface{}{inputEvent}, nil
	}

	//batch request
	batchArray, ok := batchPayload.([]interface{})
	if !ok {
		return nil, parsingError(body[:maxCachedEventsErrSize], malformedSegmentBatch)
	}

	var inputEvents []map[string]interface{}
	for _, batchElement := range batchArray {
		batchElementObj, ok := batchElement.(map[string]interface{})
		if !ok {
			return nil, parsingError(body[:maxCachedEventsErrSize], malformedSegmentBatch)
		}

		inputEvents = append(inputEvents, batchElementObj)
	}
	if len(inputEvents) > 0 && len(body) > sp.maxEventSize*len(inputEvents) {
		return nil, parsingError(body[:maxCachedEventsErrSize], fmt.Errorf("Size of one of events exceeds limit: %d", sp.maxEventSize))
	}
	return inputEvents, nil
}

//readBytes returns body bytes, json decoder, err if occurred
func readBytes(bodyReader io.ReadCloser) ([]byte, *json.Decoder, error) {
	defer bodyReader.Close()
	body, err := ioutil.ReadAll(bodyReader)
	if err != nil {
		return nil, nil, fmt.Errorf("error reading HTTP body: %v", err)
	}

	if len(body) == 0 {
		return nil, nil, errors.New("empty JSON body")
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	return body, decoder, nil
}
