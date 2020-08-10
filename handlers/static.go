package handlers

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"io/ioutil"
	"log"
	"net/http"
	"strings"
)

const contentToRemove = `"use strict";`
const jsContentType = "application/javascript"

//Serve js files
type StaticHandler struct {
	servingFiles    map[string][]byte
	serverPublicUrl string
}

type jsConfig struct {
	Key          string `json:"key" form:"key"`
	SegmentHook  bool   `json:"segment_hook" form:"segment_hook"`
	TrackingHost string `json:"tracking_host" form:"tracking_host"`
	CookieDomain string `json:"cookie_domain,omitempty" form:"cookie_domain"`
	GaHook       bool   `json:"ga_hook" form:"ga_hook"`
}

func NewStaticHandler(sourceDir, serverPublicUrl string) *StaticHandler {
	if !strings.HasSuffix(sourceDir, "/") {
		sourceDir += "/"
	}
	files, err := ioutil.ReadDir(sourceDir)
	if err != nil {
		log.Println("Error reading static file dir", sourceDir, err)
	}
	servingFiles := map[string][]byte{}
	for _, f := range files {
		if f.IsDir() {
			log.Println("Serving directories isn't supported", f.Name())
			continue
		}

		if !strings.HasSuffix(f.Name(), ".js") {
			continue
		}

		payload, err := ioutil.ReadFile(sourceDir + f.Name())
		if err != nil {
			log.Println("Error reading file", sourceDir+f.Name(), err)
			continue
		}

		reformattedPayload := strings.Replace(string(payload), contentToRemove, "", 1)

		servingFiles[f.Name()] = []byte(reformattedPayload)
		log.Println("Serve static file:", "/"+f.Name())
	}

	return &StaticHandler{servingFiles: servingFiles, serverPublicUrl: serverPublicUrl}
}

func (sh *StaticHandler) Handler(c *gin.Context) {
	fileName := c.Param("filename")

	file, ok := sh.servingFiles[fileName]
	if !ok {
		log.Println("Unknown static file request:", fileName)
		c.Status(http.StatusNotFound)
		return
	}

	c.Header("Content-type", jsContentType)
	c.Header("Access-Control-Allow-Origin", "*")

	switch fileName {
	case "inline.js":
		config := &jsConfig{}
		err := c.BindQuery(config)
		if err != nil {
			c.Status(http.StatusBadRequest)
			return
		}

		if config.Key == "" {
			c.Status(http.StatusBadRequest)
			c.Writer.Write([]byte("Mandatory key parameter is missing"))
			return
		}

		if config.TrackingHost == "" {
			if sh.serverPublicUrl != "" {
				config.TrackingHost = sh.serverPublicUrl
			} else {
				config.TrackingHost = c.Request.Host
			}
		}

		configJson, _ := json.MarshalIndent(config, "", " ")
		c.Writer.Write([]byte(`var eventnConfig = ` + string(configJson) + `;` + string(file)))
	default:
		c.Writer.Write(file)
	}
}
