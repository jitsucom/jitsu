package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"text/template"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/mitchellh/mapstructure"
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
	Result     string `json:"result"`
	Error      string `json:"error"`
	UserResult string `json:"user_result"`
	UserError  string `json:"user_error"`
	Format     string `json:"format"`
}

//Validate returns err if invalid
func (etr *EvaluateTemplateRequest) Validate() error {
	if etr.Object == nil {
		return errors.New("'object' is required field")
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
	factory storages.Factory
}

func NewEventTemplateHandler(factory storages.Factory) *EventTemplateHandler {
	return &EventTemplateHandler{
		factory: factory,
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

	var response EvaluateTemplateResponse
	if req.Reformat {
		response = evaluateReformatted(req)
	} else {
		response = h.evaluate(req)
	}

	if response.UserError != "" || response.Error != "" {
		c.JSON(http.StatusBadRequest, response)
		return
	}

	c.JSON(http.StatusOK, response)
}

func (h *EventTemplateHandler) evaluate(req *EvaluateTemplateRequest) (response EvaluateTemplateResponse) {
	response = EvaluateTemplateResponse{}
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			response.Error = fmt.Errorf("Error: %v", r).Error()
		}
	}()
	//var transformIds []string
	if req.Field == "_transform" {
		cfg := config.DestinationConfig{}
		_ = mapstructure.Decode(req.Config, &cfg)
		createFunc, dConfig, err := h.factory.Configure(req.Type, cfg)
		if err != nil {
			response.Error = fmt.Errorf("cannot setup destination: %v", err).Error()
			return
		}
		storage, err := createFunc(dConfig)
		if err != nil {
			response.Error = fmt.Errorf("cannot start destination instance: %v", err).Error()
			return
		}
		defer storage.Close()

		response.Format = "javascript"
		tmpl := storage.Processor().GetTransformer()
		if tmpl != nil {
			response.Format = tmpl.Format()
			resultObject, err := tmpl.ProcessEvent(req.Object)
			if err != nil {
				response.UserError = fmt.Errorf("error executing template: %v", err).Error()
				return
			}
			jsonBytes, err := templates.ToJSONorStringBytes(resultObject)
			if err != nil {
				response.UserError = err.Error()
				return
			}
			response.UserResult = string(jsonBytes)
		}

		envls, err := storage.Processor().ProcessEvent(req.Object, false)
		if err != nil {
			if err == schema.ErrSkipObject {
				response.Result = "SKIPPED"
				return
			} else {
				response.Error = fmt.Errorf("failed to process event: %v", err).Error()
				return
			}
		}
		objects := make([]map[string]interface{}, 0, len(envls))
		for _, envl := range envls {
			objects = append(objects, envl.Event)
		}
		var resObj interface{}
		if len(objects) == 1 {
			resObj = objects[0]
		} else {
			resObj = objects
		}
		jsonBytes, err := templates.ToJSONorStringBytes(resObj)
		if err != nil {
			response.Error = err.Error()
			return
		}
		response.Result = string(jsonBytes)
	} else {
		tmpl, err := templates.SmartParse("template evaluating", req.Expression, req.TemplateFunctions())
		if err != nil {
			response.Error = fmt.Errorf("error parsing template: %v", err).Error()
			return
		}
		response.Format = tmpl.Format()
		resultObject, err := tmpl.ProcessEvent(req.Object)
		if err != nil {
			response.Error = fmt.Errorf("error executing template: %v", err).Error()
			return
		}
		jsonBytes, err := templates.ToJSONorStringBytes(resultObject)
		if err != nil {
			response.Error = err.Error()
			return
		}
		response.Result = string(jsonBytes)
	}
	return
}

func evaluateReformatted(req *EvaluateTemplateRequest) (response EvaluateTemplateResponse) {
	response = EvaluateTemplateResponse{}
	tableNameExtractor, err := schema.NewTableNameExtractor(req.Expression, req.TemplateFunctions())
	if err != nil {
		response.Error = err.Error()
		return
	}
	defer tableNameExtractor.Close()
	response.Format = tableNameExtractor.Format()
	res, err := tableNameExtractor.Extract(req.Object)
	if err != nil {
		response.Error = fmt.Errorf("%v\ntemplate body:\n%v\n", err, tableNameExtractor.Expression).Error()
	}
	response.Result = res
	return
}
