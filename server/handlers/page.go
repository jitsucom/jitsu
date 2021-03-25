package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
	"html/template"
	"io/ioutil"
	"net/http"
	"strings"
)

const htmlContentType = "text/html; charset=utf-8"
const welcomePageName = "welcome.html"
const hostConstant = "<REPLACE WITH DEPLOYED HOST URL>"

var blankPage = []byte(`<html><head></head><body></body></html>`)

type PageHandler struct {
	serverPublicURL string
	welcome         *template.Template
}

//Serve html files
func NewPageHandler(sourceDir, serverPublicURL string, disableWelcomePage bool) (ph *PageHandler) {
	ph = &PageHandler{serverPublicURL: serverPublicURL}

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

	logging.Info("Serve html file:", "/"+welcomePageName)

	ph.welcome = welcomeHTMLTmpl

	return
}

func (ph *PageHandler) Handler(c *gin.Context) {
	c.Header("Content-type", htmlContentType)

	fileName := c.Param("filename")

	switch fileName {
	case welcomePageName:
		if ph.welcome == nil {
			c.Writer.Write(blankPage)
			return
		}

		host := c.GetHeader("Host")
		if ph.serverPublicURL != "" {
			host = ph.serverPublicURL
		}
		if host == "" {
			host = hostConstant
		}

		parameters := map[string]string{"DeployHost": host}
		err := ph.welcome.Execute(c.Writer, parameters)
		if err != nil {
			logging.Error("Error executing welcome.html template", err)
		}
	default:
		c.AbortWithStatus(http.StatusNotFound)
	}
}
