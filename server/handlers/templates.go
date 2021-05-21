package handlers

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/schema"
	"net/http"
	"text/template"
)

//EvaluateTemplateRequest is a request dto for testing text/template expressions
type EvaluateTemplateRequest struct {
	Object     map[string]interface{} `json:"object,omitempty"`
	Expression string                 `json:"expression,omitempty"`
	Reformat   bool                   `json:"reformat,omitempty"`
}

//EvaluateTemplateResponse is a response dto for testing text/template expressions
type EvaluateTemplateResponse struct {
	Result string `json:"result"`
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

//EventTemplateHandler is a handler for testing text/template expression with income object
func EventTemplateHandler(c *gin.Context) {
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
	var err error

	if req.Reformat {
		result, err = evaluateReformatted(req)
	} else {
		result, err = evaluate(req)
	}

	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, EvaluateTemplateResponse{Result: result})
}

func evaluate(req *EvaluateTemplateRequest) (result string, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("Error: %v", r)
		}
	}()

	tmpl, err := template.New("template evaluating").
		Parse(req.Expression)
	if err != nil {
		return "", fmt.Errorf("Error parsing template: %v", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, req.Object); err != nil {
		return "", fmt.Errorf("Error evaluating template: %v", err)
	}

	return buf.String(), nil
}

func evaluateReformatted(req *EvaluateTemplateRequest) (string, error) {
	tableNameExtractor, err := schema.NewTableNameExtractor(req.Expression)
	if err != nil {
		return "", err
	}

	return tableNameExtractor.Extract(req.Object)
}
