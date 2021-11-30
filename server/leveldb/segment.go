package leveldb

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path"
	"sync/atomic"
)

type Element struct {
	ID      uint64
	Payload map[string]interface{}
}

type Segment struct {
	head, tail uint64

	fileID uint64

	queue chan *Element
	file  *os.File
}

//newSegment creates new segment:
// 1. creates new file (or open existing one)
// 2. put provided objects to the queue channel
func newSegment(dir string, fileID uint64, objects []map[string]interface{}, opts *Options) (*Segment, error) {
	f, err := os.OpenFile(path.Join(dir, fileName(fileID)), os.O_RDWR|os.O_CREATE, opts.FilePerms)
	if err != nil {
		return nil, err
	}

	segment := &Segment{
		head:   0,
		tail:   uint64(math.Max(float64(len(objects)-1), float64(len(objects)))),
		fileID: fileID,
		queue:  make(chan *Element, defaultSegmentSize),
		file:   f,
	}

	for _, obj := range objects {
		segment.queue <- &Element{
			ID:      0, //TODO
			Payload: obj,
		}
	}

	return segment, nil
}

func (s *Segment) push(object map[string]interface{}) error {
	id := atomic.AddUint64(&s.tail, 1)
	if id > defaultSegmentSize {
		return errSegmentFull
	}

	e := Element{
		ID:      id,
		Payload: object,
	}
	b, _ := json.Marshal(e)
	buf := bytes.NewBuffer(b)
	buf.Write([]byte("\n"))
	if _, err := s.file.Write(buf.Bytes()); err != nil {
		return fmt.Errorf("error writing [%s] element to [%s] segment: %v", b, fileName(s.fileID), err)
	}

	s.queue <- &e

	return nil
}

func (s *Segment) pop() (map[string]interface{}, error) {
	select {
	case element := <-s.queue:
		atomic.AddUint64(&s.head, 1)
		return element.Payload, nil
	default:
		return nil, errSegmentEmpty
	}
}

func fileName(fileID uint64) string {
	return fmt.Sprintf("%06d%s", fileID, walSuffix)
	//return fmt.Sprintf("%d%s", fileID, walSuffix)
}
