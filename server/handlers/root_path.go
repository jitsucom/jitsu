package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/system"
	"github.com/jitsucom/jitsu/server/utils"
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

var signaturePage = `<html><head><title>Jitsu edge server ver [VERSION]</title></head><body><pre><small><b>Jitsu edge server ver [VERSION]. <a href="[CONFIGURATOR_URL]">Configure Jitsu</a></b></small></pre></body></html>`
var blankPage = `<html><head></head><body></body></html>`

//RootPathHandler serves:
// HTTP redirect to Configurator
// HTML Welcome page or blanc page
type RootPathHandler struct {
	service          *system.Service
	configuratorURN  string
	welcome          *template.Template
	disableSignature bool
	redirectToHttps  bool
}

//NewRootPathHandler reads sourceDir and returns RootPathHandler instance
func NewRootPathHandler(service *system.Service, sourceDir, configuratorURN string, disableWelcomePage, redirectToHttps, disableSignature bool) *RootPathHandler {
	rph := &RootPathHandler{service: service, configuratorURN: configuratorURN, redirectToHttps: redirectToHttps, disableSignature: disableSignature}

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
		redirectSchema := utils.NvlString(c.GetHeader("X-Forwarded-Proto"), c.Request.URL.Scheme)
		redirectHost := utils.NvlString(c.GetHeader("X-Forwarded-Host"), c.Request.Host)
		realHost := utils.NvlString(c.GetHeader("X-Real-Host"), redirectHost, c.Request.Host)
		if rph.redirectToHttps {
			//use X-Forwarded-Host if redirect to https
			//used in heroku deployments
			redirectSchema = "https"
			realHost = redirectHost
		}

		redirectURL := redirectSchema + "://" + realHost + viper.GetString("server.configurator_urn")
		c.Redirect(http.StatusTemporaryRedirect, redirectURL)
		return
	}

	c.Header("Content-type", htmlContentType)

	if rph.welcome == nil {
		if !rph.disableSignature {
			var html = strings.ReplaceAll(signaturePage, "[VERSION]", appconfig.RawVersion+" / "+appconfig.BuiltAt)
			html = strings.ReplaceAll(html, "[CONFIGURATOR_URL]", rph.configuratorURN)
			c.Writer.Write([]byte(html))
		} else {
			c.Writer.Write([]byte(blankPage))
		}
		return
	}

	parameters := map[string]interface{}{configuratorPresentKey: false, configuratorURLKey: ""}
	if rph.configuratorURN != "" {
		parameters[configuratorURLKey] = rph.configuratorURN
		parameters[configuratorPresentKey] = true
	}

	err := rph.welcome.Execute(c.Writer, parameters)
	if err != nil {
		logging.Error("Error executing welcome.html template", err)
	}
}
