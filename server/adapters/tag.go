package adapters

import (
	"errors"
	"fmt"

	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/utils"
)

type TagConfig struct {
	TagID    string `mapstructure:"tagid,omitempty" json:"tagid,omitempty" yaml:"tagid,omitempty"`
	Template string `mapstructure:"template,omitempty" json:"template,omitempty" yaml:"template,omitempty"`
	Filter   string `mapstructure:"filter,omitempty" json:"filter,omitempty" yaml:"filter,omitempty"`
}

//Validate returns err if invalid
func (tc *TagConfig) Validate() error {
	if tc.Template == "" {
		return errors.New("Template is required")
	}

	return nil
}

//Tag that returns HTML tag based on incoming event. HTML tag supposed to be added to the page with javascript-sdk
type Tag struct {
	tagId    string
	template templates.TemplateExecutor
}

func NewTag(config *TagConfig, destinationId string) (*Tag, error) {
	tagId := utils.NvlString(config.TagID, destinationId)
	template, err := templates.NewGoTemplateExecutor(tagId, config.Template, templates.JSONSerializeFuncs)
	if err != nil {
		return nil, err
	}
	return &Tag{tagId: tagId, template: template}, nil
}

func (t *Tag) ProcessEvent(event map[string]interface{}) (map[string]interface{}, error) {
	value, err := t.template.ProcessEvent(event, nil)
	if err != nil {
		return nil, fmt.Errorf("error in processing tag destination template: %v", err)
	}
	return map[string]interface{}{"type": "tag", "id": t.tagId, "value": value}, nil
}

func (t *Tag) Insert(insertContext *InsertContext) error {
	return fmt.Errorf("Insert not supported for tag destination")
}

func (t *Tag) Close() error {
	t.template.Close()
	return nil
}

//Type returns adapter type
func (t *Tag) Type() string {
	return "tag"
}
