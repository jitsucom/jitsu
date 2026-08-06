package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"io"
	"net/http"
	"sync/atomic"
)

type Script struct {
	scriptCode  []byte
	gzippedCode []byte
	etag        string
}

func (s *Script) GetScript() []byte {
	return s.scriptCode
}

func (s *Script) GetEtag() string {
	return s.etag
}

func (s *Script) WriteScript(c *gin.Context, head bool, gzip bool) {
	c.Header("Cache-Control", "public, max-age=120")
	etag := s.etag
	var body []byte
	if gzCode := s.gzippedCode; gzip && len(gzCode) > 0 {
		c.Header("Content-Encoding", "gzip")
		c.Header("Vary", "Accept-Encoding")
		body = gzCode
	} else {
		body = s.scriptCode
	}
	if etag != "" {
		c.Header("ETag", etag)
	}
	c.Header("Content-Length", fmt.Sprintf("%d", len(body)))
	if head {
		c.Header("Content-Type", "application/javascript")
		c.Status(http.StatusOK)
		return
	} else {
		c.Data(http.StatusOK, "application/javascript", body)
	}
}

type ScriptRepositoryData struct {
	data atomic.Pointer[Script]
}

func (s *ScriptRepositoryData) gzip(code []byte) []byte {
	buf := bytes.NewBuffer([]byte{})
	writer := gzip.NewWriter(buf)
	_, err := writer.Write(code)
	if err == nil {
		err = writer.Close()
		if err == nil {
			gzippedCode := buf.Bytes()
			return gzippedCode
		}
	}
	return nil
}

func (s *ScriptRepositoryData) Init(reader io.Reader, tag any) error {
	code, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	d := &Script{
		scriptCode:  code,
		gzippedCode: s.gzip(code),
	}
	if tag != nil {
		d.etag = tag.(string)
	}
	s.data.Store(d)
	return nil
}

func (s *ScriptRepositoryData) GetData() *Script {
	return s.data.Load()
}

func (s *ScriptRepositoryData) Store(writer io.Writer) error {
	d := s.data.Load()
	if d != nil {
		_, err := writer.Write(d.scriptCode)
		return err
	}
	return nil
}

func NewScriptRepository(scriptOrigin, cacheDir string) *appbase.HTTPRepository[Script] {
	return appbase.NewHTTPRepository[Script]("p.js", scriptOrigin, "", appbase.HTTPTagETag, &ScriptRepositoryData{}, 5, 120, cacheDir, appbase.ExitOnNoData)
}
