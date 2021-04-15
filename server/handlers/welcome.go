package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
	"html/template"
	"io/ioutil"
	"strings"
)

const (
	htmlContentType = "text/html; charset=utf-8"
	welcomePageName = "welcome.html"

	configuratorPresentKey = "__JITSU_CONFIGURATOR_PRESENT__"
	configuratorURLKey     = "__JITSU_CONFIGURATOR_URL__"
)

var blankPage = []byte(`<html><head></head><body></body></html>`)

//WelcomePageHandler serves HTML Welcome page
type WelcomePageHandler struct {
	configuratorURL string
	welcome         *template.Template
}

//NewWelcomePageHandler reads sourceDir and returns WelcomePageHandler instance
func NewWelcomePageHandler(sourceDir, configuratorURL string, disableWelcomePage bool) (ph *WelcomePageHandler) {
	ph = &WelcomePageHandler{configuratorURL: configuratorURL}

	if disableWelcomePage {
		return
	}

	if !strings.HasSuffix(sourceDir, "/") {
		sourceDir += "/"
	}
	payload, err := ioutil.ReadFile(sourceDir + welcomePageName)
	if err != nil {
		logging.Errorf("Error reading %s file: %v", sourceDir+welcomePageName, err)
		return
	}

	welcomeHTMLTmpl, err := template.New("html template").
		Option("missingkey=zero").
		Parse(string(payload))
	if err != nil {
		logging.Error("Error parsing html template from", welcomePageName, err)
		return
	}

	ph.welcome = welcomeHTMLTmpl

	return
}

func (ph *WelcomePageHandler) Handler(c *gin.Context) {
	c.Header("Content-type", htmlContentType)

	if ph.welcome == nil {
		c.Writer.Write(blankPage)
		return
	}

	parameters := map[string]interface{}{configuratorPresentKey: false, configuratorURLKey: ""}
	if ph.configuratorURL != "" {
		parameters[configuratorURLKey] = ph.configuratorURL
		parameters[configuratorPresentKey] = true
	}

	err := ph.welcome.Execute(c.Writer, parameters)
	if err != nil {
		logging.Error("Error executing welcome.html template", err)
	}
}
