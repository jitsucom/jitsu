package events

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/maputils"
	"io"
	"io/ioutil"
	"time"
)

const (
	batchKey = "batch"

	timezoneKey             = "timezone"
	localTzOffsetMinutesKey = "local_tz_offset"

	screenKey           = "screen"
	screenWidthKey      = "width"
	screenHeightKey     = "height"
	screenResolutionKey = "screen_resolution"

	messageIDKey = "messageId"
)

var malformedSegmentBatch = errors.New("malformed Segment body 'batch' type. Expected array of objects")

//Parser is used for parsing income HTTP event body
type Parser interface {
	ParseEventsBody(c *gin.Context) ([]Event, error)
}

//jitsuParser parses Jitsu events
type jitsuParser struct{}

//NewJitsuParser returns jitsuParser
func NewJitsuParser() Parser {
	return &jitsuParser{}
}

//ParseEventsBody parses HTTP body and returns Event objects or err if occurred
//unwraps template events if exists
func (jp *jitsuParser) ParseEventsBody(c *gin.Context) ([]Event, error) {
	body, decoder, err := readBytes(c.Request.Body)
	if err != nil {
		return nil, err
	}

	switch body[0] {
	case '{':
		event := Event{}
		if err := decoder.Decode(&event); err != nil {
			return nil, fmt.Errorf("error parsing HTTP body: %v", err)
		}

		eventsArray, ok := jp.parseTemplateEvents(event)
		if ok {
			return eventsArray, nil
		}

		return []Event{event}, nil
	case '[':
		inputEvents := []Event{}
		if err := decoder.Decode(&inputEvents); err != nil {
			return nil, fmt.Errorf("error parsing HTTP body: %v", err)
		}

		return inputEvents, nil
	default:
		return nil, fmt.Errorf("malformed JSON body begins with: %q", string(body[0]))
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

//segmentParser parses Segment compatibility API events
type segmentParser struct {
	globalUniqueID *identifiers.UniqueID
	mapper         Mapper
}

//NewSegmentParser returns configured Segment Parser
func NewSegmentParser(mapper Mapper, globalUniqueID *identifiers.UniqueID) Parser {
	return &segmentParser{globalUniqueID: globalUniqueID, mapper: mapper}
}

//ParseEventsBody extracts batch events from HTTP body
//maps them into Jitsu format
//returns array of events or error if occurred
func (sp *segmentParser) ParseEventsBody(c *gin.Context) ([]Event, error) {
	inputEvents, err := sp.parseSegmentBody(c.Request.Body)
	if err != nil {
		return nil, err
	}

	var resultEvents []Event
	for _, input := range inputEvents {
		mapped, err := sp.mapper.Map(input)
		if err != nil {
			return nil, err
		}

		//timezone
		tz, ok := mapped[timezoneKey]
		if ok {
			l, err := time.LoadLocation(fmt.Sprint(tz))
			if err == nil {
				_, offsetSeconds := time.Now().In(l).Zone()
				mapped[localTzOffsetMinutesKey] = (time.Second * time.Duration(offsetSeconds)).Minutes()
			}

			delete(mapped, timezoneKey)
		}

		//vp_size
		screen, ok := mapped[screenKey]
		if ok {
			screenObj, ok := screen.(map[string]interface{})
			if ok {
				width, widthOk := screenObj[screenWidthKey]
				height, heightOk := screenObj[screenHeightKey]

				if widthOk && heightOk {
					mapped[screenResolutionKey] = fmt.Sprintf("%vx%v", width, height)
				}
			}

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
func (sp *segmentParser) parseSegmentBody(body io.ReadCloser) ([]map[string]interface{}, error) {
	_, decoder, err := readBytes(body)
	if err != nil {
		return nil, err
	}

	inputEvent := map[string]interface{}{}
	if err := decoder.Decode(&inputEvent); err != nil {
		return nil, fmt.Errorf("error parsing HTTP body: %v", err)
	}

	batchPayload, ok := inputEvent[batchKey]
	if !ok {
		//isn't batch request
		return []map[string]interface{}{inputEvent}, nil
	}

	//batch request
	batchArray, ok := batchPayload.([]interface{})
	if !ok {
		return nil, malformedSegmentBatch
	}

	var inputEvents []map[string]interface{}
	for _, batchElement := range batchArray {
		batchElementObj, ok := batchElement.(map[string]interface{})
		if !ok {
			return nil, malformedSegmentBatch
		}

		inputEvents = append(inputEvents, batchElementObj)
	}

	return inputEvents, nil
}

//readBytes returns body bytes, json decoder, err if occurred
func readBytes(bodyReader io.ReadCloser) ([]byte, *json.Decoder, error) {
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
