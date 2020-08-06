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

type PageHandler struct {
	serverPublicUrl string
	welcome         *template.Template
}

func NewPageHandler(sourceDir, serverPublicUrl string) (ph *PageHandler) {
	ph = &PageHandler{serverPublicUrl: serverPublicUrl}

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
	c.Header("Access-Control-Allow-Origin", "*")

	fileName := c.Param("filename")

	switch fileName {
	case welcomePageName:
		if ph.welcome == nil {
			log.Println("Html template", welcomePageName, "was not found")
			c.AbortWithStatus(http.StatusNotFound)
			return
		}

		host := c.GetHeader("Host")
		if ph.serverPublicUrl != "" {
			host = ph.serverPublicUrl
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
