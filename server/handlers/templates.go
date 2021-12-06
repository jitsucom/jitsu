package handlers

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/plugins"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/mitchellh/mapstructure"
	"net/http"
	"text/template"
)

//EvaluateTemplateRequest is a request dto for testing text/template expressions
type EvaluateTemplateRequest struct {
	Config            map[string]interface{} `json:"config,omitempty"`
	Object            map[string]interface{} `json:"object,omitempty"`
	Expression        string                 `json:"expression,omitempty"`
	Reformat          bool                   `json:"reformat,omitempty"`
	Type              string                 `json:"type,omitempty"`
	Uid               string                 `json:"uid,omitempty"`
	Field             string                 `json:"field,omitempty"`
	TemplateVariables map[string]interface{} `json:"template_variables,omitempty"`
}

//EvaluateTemplateResponse is a response dto for testing text/template expressions
type EvaluateTemplateResponse struct {
	Result string `json:"result"`
	Error  string `json:"message"`
	Format string `json:"format"`
}

//Validate returns err if invalid
func (etr *EvaluateTemplateRequest) Validate() error {
	if etr.Object == nil {
		return errors.New("'object' is required field")
	}

	if etr.Expression == "" {
		return errors.New("'expression' is required field")
	}

	return nil
}

//TemplateFunctions fills temlate functions with destination data from request
func (etr *EvaluateTemplateRequest) TemplateFunctions() template.FuncMap {
	vars := map[string]interface{}{"destinationId": etr.Uid, "destinationType": etr.Type}
	utils.MapPutAll(vars, etr.TemplateVariables)
	return templates.EnrichedFuncMap(vars)
}

//EventTemplateHandler is a handler for testing text/template expression with income object
type EventTemplateHandler struct {
	pluginsRepository plugins.PluginsRepository
	factory           storages.Factory
}

func NewEventTemplateHandler(pluginsRepository plugins.PluginsRepository, factory storages.Factory) *EventTemplateHandler {
	return &EventTemplateHandler{
		pluginsRepository: pluginsRepository,
		factory:           factory,
	}
}

func (h *EventTemplateHandler) Handler(c *gin.Context) {
	req := &EvaluateTemplateRequest{}
	if err := c.BindJSON(req); err != nil {
		logging.Errorf("Error parsing evaluate template body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	if err := req.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	var result string
	var format string
	var err error

	if req.Reformat {
		result, format, err = evaluateReformatted(req)
	} else {
		result, format, err = h.evaluate(req)
	}

	if err != nil {
		c.JSON(http.StatusBadRequest, EvaluateTemplateResponse{Result: result, Format: format, Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, EvaluateTemplateResponse{Result: result, Format: format})
}

func (h *EventTemplateHandler) evaluate(req *EvaluateTemplateRequest) (result string, format string, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("Error: %v", r)
		}
	}()
	//var transformIds []string
	var tmpl templates.TemplateExecutor
	if req.Field == "_transform" {
		cfg := config.DestinationConfig{}
		_ = mapstructure.Decode(req.Config, &cfg)
		createFunc, dConfig, err := h.factory.Configure(req.Type, cfg)
		if err != nil {
			return "", "", fmt.Errorf("cannot setup npm destination: %v", err)
		}
		storage, err := createFunc(dConfig)
		if err != nil {
			return "", "", fmt.Errorf("cannot instantiate instance of npm destination: %v", err)
		}
		err = storage.Processor().InitJavaScriptTemplates()
		if err != nil {
			return "", "", fmt.Errorf("failed to init javascript template: %v", err)
		}
		tmpl = storage.Processor().GetTransformer()
		if tmpl == nil {
			return "", "", fmt.Errorf("javascript template was not initialized")
		}
	} else {
		tmpl, err = templates.SmartParse("template evaluating", req.Expression, req.TemplateFunctions())
	}
	if err != nil {
		return "", "", fmt.Errorf("error parsing template: %v", err)
	}
	resultObject, err := tmpl.ProcessEvent(req.Object)
	if err != nil {
		return "", tmpl.Format(), fmt.Errorf("error executing template: %v", err)
	}
	jsonBytes, err := templates.ToJSONorStringBytes(resultObject)
	if err != nil {
		return "", tmpl.Format(), err
	}
	result = string(jsonBytes)
	format = tmpl.Format()
	return
}

func evaluateReformatted(req *EvaluateTemplateRequest) (string, string, error) {
	tableNameExtractor, err := schema.NewTableNameExtractor(req.Expression, req.TemplateFunctions())
	if err != nil {
		return "", "", err
	}
	res, err := tableNameExtractor.Extract(req.Object)
	if err != nil {
		err = fmt.Errorf("%v\ntemplate body:\n%v\n", err, tableNameExtractor.Expression)
	}
	return res, tableNameExtractor.Format(), err
}
