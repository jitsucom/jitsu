package handlers

import (
	"github.com/gin-gonic/gin"
	"html/template"
	"io/ioutil"
	"log"
	"net/http"
	"strings"
)

const htmlContentType = "text/html; charset=utf-8"
const welcomePageName = "welcome.html"
const hostConstant = "<REPLACE WITH DEPLOYED HOST URL>"

var blankPage = []byte(`<html><head></head><body></body></html>`)

type PageHandler struct {
	serverPublicUrl string
	welcome         *template.Template
}

//Serve html files
func NewPageHandler(sourceDir, serverPublicUrl string, disableWelcomePage bool) (ph *PageHandler) {
	ph = &PageHandler{serverPublicUrl: serverPublicUrl}

	if disableWelcomePage {
		return
	}

	if !strings.HasSuffix(sourceDir, "/") {
		sourceDir += "/"
	}
	payload, err := ioutil.ReadFile(sourceDir + welcomePageName)
	if err != nil {
		log.Printf("Error reading %s file: %v", sourceDir+welcomePageName, err)
		return
	}

	welcomeHtmlTmpl, err := template.New("html template").
		Option("missingkey=zero").
		Parse(string(payload))
	if err != nil {
		log.Println("Error parsing html template from", welcomePageName, err)
		return
	}

	log.Println("Serve html file:", "/"+welcomePageName)

	ph.welcome = welcomeHtmlTmpl

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
		if ph.serverPublicUrl != "" {
			host = ph.serverPublicUrl
		}
		if host == "" {
			host = hostConstant
		}

		parameters := map[string]string{"DeployHost": host}
		err := ph.welcome.Execute(c.Writer, parameters)
		if err != nil {
			log.Println("Error executing welcome.html template", err)
		}
	default:
		c.AbortWithStatus(http.StatusNotFound)
	}
}
