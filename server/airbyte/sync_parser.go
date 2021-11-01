package airbyte

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"strings"
)

type synchronousParser struct {
	desiredRowType string

	output    *logging.StringWriter
	parsedRow *Row
}

func (sp *synchronousParser) parse(r io.Reader) error {
	sp.output = logging.NewStringWriter()
	if _, err := io.Copy(sp.output, r); err != nil {
		return fmt.Errorf("error reading: %v", err)
	}

	parts := strings.Split(sp.output.String(), "\n")
	for _, p := range parts {
		parsedRow := &Row{}
		//skip all not JSON rows
		if err := json.Unmarshal([]byte(p), parsedRow); err != nil {
			continue
		}

		if parsedRow.Type != sp.desiredRowType {
			continue
		}

		sp.parsedRow = parsedRow

		return nil
	}

	return fmt.Errorf("Error synchronously parsing airbyte result: %s", sp.output.String())
}
