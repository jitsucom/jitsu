package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/system"
	"github.com/spf13/viper"
	"html/template"
	"io/ioutil"
	"net/http"
	"strings"
)

const (
	htmlContentType = "text/html; charset=utf-8"
	welcomePageName = "welcome.html"

	configuratorPresentKey = "__JITSU_CONFIGURATOR_PRESENT__"
	configuratorURLKey     = "__JITSU_CONFIGURATOR_URL__"
)

var blankPage = []byte(`<html><head></head><body></body></html>`)

//RootPathHandler serves:
// HTTP redirect to Configurator
// HTML Welcome page or blanc page
type RootPathHandler struct {
	service         *system.Service
	configuratorURL string
	welcome         *template.Template
	redirectToHttps bool
}

//NewRootPathHandler reads sourceDir and returns RootPathHandler instance
func NewRootPathHandler(service *system.Service, sourceDir, configuratorURL string, disableWelcomePage, redirectToHttps bool) *RootPathHandler {
	rph := &RootPathHandler{service: service, configuratorURL: configuratorURL, redirectToHttps: redirectToHttps}

	if service.IsConfigured() {
		return rph
	}

	if disableWelcomePage {
		return rph
	}

	if !strings.HasSuffix(sourceDir, "/") {
		sourceDir += "/"
	}
	payload, err := ioutil.ReadFile(sourceDir + welcomePageName)
	if err != nil {
		logging.Errorf("Error reading %s file: %v", sourceDir+welcomePageName, err)
		return rph
	}

	welcomeHTMLTmpl, err := template.New("html template").
		Option("missingkey=zero").
		Parse(string(payload))
	if err != nil {
		logging.Error("Error parsing html template from", welcomePageName, err)
		return rph
	}

	rph.welcome = welcomeHTMLTmpl

	return rph
}

//Handler handles requests and returns welcome page or redirect to Configurator URL
func (rph *RootPathHandler) Handler(c *gin.Context) {
	if rph.service.ShouldBeRedirected() {
		redirectSchema := c.GetHeader("X-Forwarded-Proto")
		redirectHost := c.GetHeader("X-Forwarded-Host")
		redirectPort := c.GetHeader("X-Forwarded-Port")
		if rph.redirectToHttps {
			redirectSchema = "https"
		}

		redirectURL := redirectSchema + "://" + redirectHost
		if redirectPort != "" {
			redirectURL += ":" + redirectPort
		}
		c.Redirect(http.StatusTemporaryRedirect, redirectURL+viper.GetString("server.configurator_url"))
		return
	}

	c.Header("Content-type", htmlContentType)

	if rph.welcome == nil {
		c.Writer.Write(blankPage)
		return
	}

	parameters := map[string]interface{}{configuratorPresentKey: false, configuratorURLKey: ""}
	if rph.configuratorURL != "" {
		parameters[configuratorURLKey] = rph.configuratorURL
		parameters[configuratorPresentKey] = true
	}

	err := rph.welcome.Execute(c.Writer, parameters)
	if err != nil {
		logging.Error("Error executing welcome.html template", err)
	}
}
