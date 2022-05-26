package storages

import (
	"encoding/json"
	"reflect"
	"strings"

	"github.com/pkg/errors"
)

type auditRecordKey struct {
	ObjectType string `json:"objectType"`
	ProjectID  string `json:"projectId,omitempty"`
	ObjectID   string `json:"objectId,omitempty"`
}

func (k auditRecordKey) String() string {
	var b strings.Builder
	b.WriteString(k.ObjectType)

	if k.ProjectID != "" {
		b.WriteString(":" + k.ProjectID)
	}

	if k.ObjectID != "" && k.ObjectID != k.ProjectID {
		b.WriteString(":" + k.ObjectID)
	}

	return b.String()
}

type auditRecord struct {
	auditRecordKey
	UserID     string      `json:"userId,omitempty"`
	RecordedAt string      `json:"recordedAt"`
	OldValue   interface{} `json:"oldValue,omitempty"`
	NewValue   interface{} `json:"newValue,omitempty"`
}

func (r *auditRecord) isValid() (bool, error) {
	var oldData json.RawMessage
	if r.OldValue == nil {
		// do nothing
	} else if data, ok := r.OldValue.(json.RawMessage); ok {
		oldData = data
	} else if data, err := json.Marshal(r.OldValue); err != nil {
		return false, errors.Wrap(err, "marshal old value")
	} else {
		oldData = data
	}

	var newData json.RawMessage
	if r.NewValue == nil {
		// do nothing
	} else if data, ok := r.NewValue.(json.RawMessage); ok {
		newData = data
	} else if data, err := json.Marshal(r.NewValue); err != nil {
		return false, errors.Wrap(err, "marshal new value")
	} else {
		newData = data
	}

	var oldValue interface{} = nil
	if oldData != nil {
		if err := json.Unmarshal(oldData, &oldValue); err != nil {
			return false, errors.Wrap(err, "unmarshal old value into interface{}")
		}
	}

	var newValue interface{} = nil
	if newData != nil {
		if err := json.Unmarshal(newData, &newValue); err != nil {
			return false, errors.Wrap(err, "unmarshal new value into interface{}")
		}
	}

	return !reflect.DeepEqual(oldValue, newValue), nil
}
