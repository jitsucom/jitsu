package handlers

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
	"io/ioutil"
	"net/http"
	"strings"
)

const contentToRemove = `"use strict";`
const jsContentType = "application/javascript"

const inlineJs = "inline.js"
const jsConfigVar = "eventnConfig"

const eventsChainJsTemplate = "eventN.track('%s'); "

//StaticHandler serves js files
type StaticHandler struct {
	servingFiles    map[string][]byte
	gzippedFiles    map[string][]byte
	serverPublicURL string
	inlineJsParts   [][]byte
}

type jsConfig struct {
	Key          string `json:"key" form:"key"`
	SegmentHook  bool   `json:"segment_hook" form:"segment_hook"`
	TrackingHost string `json:"tracking_host" form:"tracking_host"`
	CookieDomain string `json:"cookie_domain,omitempty" form:"cookie_domain"`
	GaHook       bool   `json:"ga_hook" form:"ga_hook"`
	RandomizeURL bool   `json:"randomize_url" form:"randomize_url"`
}

func NewStaticHandler(sourceDir, serverPublicURL string) *StaticHandler {
	if !strings.HasSuffix(sourceDir, "/") {
		sourceDir += "/"
	}
	files, err := ioutil.ReadDir(sourceDir)
	if err != nil {
		logging.Error("Error reading static file dir", sourceDir, err)
	}
	servingFiles := map[string][]byte{}
	gzippedFiles := map[string][]byte{}
	for _, f := range files {
		if f.IsDir() {
			logging.Warn("Serving directories isn't supported", f.Name())
			continue
		}

		if !strings.HasSuffix(f.Name(), ".js") && !strings.HasSuffix(f.Name(), ".js.map") {
			continue
		}

		payload, err := ioutil.ReadFile(sourceDir + f.Name())
		if err != nil {
			logging.Error("Error reading file", sourceDir+f.Name(), err)
			continue
		}

		reformattedPayload := strings.Replace(string(payload), contentToRemove, "", 1)

		servingFiles[f.Name()] = []byte(reformattedPayload)
		gzipped, err := gzipData(servingFiles[f.Name()])
		if err != nil {
			logging.Error("Failed to gzip", sourceDir+f.Name(), err)
		} else {
			gzippedFiles[f.Name()] = gzipped
		}
		logging.Info("📄 Serve static file:", "/"+f.Name())
	}
	var inlineJsParts = make([][]byte, 2)
	for i, part := range strings.Split(string(servingFiles[inlineJs]), jsConfigVar) {
		inlineJsParts[i] = []byte(part)
	}
	return &StaticHandler{
		servingFiles:    servingFiles,
		serverPublicURL: serverPublicURL,
		inlineJsParts:   inlineJsParts,
		gzippedFiles:    gzippedFiles,
	}
}

func (sh *StaticHandler) Handler(c *gin.Context) {
	fileName := c.Param("filename")

	file, ok := sh.servingFiles[fileName]
	if !ok {
		logging.Error("Unknown static file request:", fileName)
		c.Status(http.StatusNotFound)
		return
	}

	c.Header("Content-type", jsContentType)

	c.Header("Vary", "Accept-Encoding")
	c.Writer.Header().Set("Access-Control-Allow-Origin", "*")

	switch fileName {
	case inlineJs:
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
			if sh.serverPublicURL != "" {
				config.TrackingHost = sh.serverPublicURL
			} else {
				config.TrackingHost = c.Request.Host
			}
		}

		c.Writer.Write(sh.inlineJsParts[0])
		configJSON, _ := json.MarshalIndent(config, "", " ")
		c.Writer.Write(configJSON)
		c.Writer.Write(sh.inlineJsParts[1])

		eventsArr, ok := c.GetQueryArray("event")
		if ok {
			for _, event := range eventsArr {
				c.Writer.Write([]byte(fmt.Sprintf(eventsChainJsTemplate, event)))
			}
		}

	default:
		gzipped, ok := sh.gzippedFiles[fileName]
		if ok && strings.Contains(c.Request.Header.Get("Accept-Encoding"), "gzip") {
			c.Header("Content-Encoding", "gzip")
			c.Writer.Write(gzipped)
		} else {
			c.Writer.Write(file)
		}
	}
}

func gzipData(data []byte) (compressedData []byte, err error) {
	var b bytes.Buffer
	gz, _ := gzip.NewWriterLevel(&b, gzip.BestCompression)

	_, err = gz.Write(data)
	if err != nil {
		return
	}

	if err = gz.Flush(); err != nil {
		return
	}

	if err = gz.Close(); err != nil {
		return
	}

	compressedData = b.Bytes()

	return
}
