package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/templates"
	"net/http"
	"strings"
)

type SdkSourceHandler struct {
	httpClient *http.Client
}

func NewSdkSourceHandler() *SdkSourceHandler {
	return &SdkSourceHandler{httpClient: &http.Client{Timeout: defaultTimeout}}
}

// SpecHandler returns sdk source spec by package name (with version)
func (ah *SdkSourceHandler) SpecHandler(c *gin.Context) {
	packageNameVer := c.Query("package")
	if packageNameVer == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("package is required path parameter", nil))
		return
	}

	sourcePlugin := &templates.SourcePlugin{
		Package: packageNameVer,
		ID:      base.SdkSourceType,
		Type:    base.SdkSourceType,
		Config:  nil,
	}
	sourceExecutor, err := templates.NewSourceExecutor(sourcePlugin)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to init source from npm package: "+packageNameVer, err))
		return
	}
	defer sourceExecutor.Close()

	c.JSON(http.StatusOK, SpecResponse{
		StatusResponse: middleware.OKResponse(),
		Spec:           sourceExecutor.Spec(),
	})
}

// CatalogHandler returns sdk source catalog by package_name@version and config
func (ah *SdkSourceHandler) CatalogHandler(c *gin.Context) {
	packageNameVer := c.Query("package")
	if packageNameVer == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("package is required path parameter", nil))
		return
	}

	sdkSourceConnectorConfig := map[string]interface{}{}
	if err := c.BindJSON(&sdkSourceConnectorConfig); err != nil {
		logging.Errorf("Error parsing sdk source connector body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	iof := strings.LastIndexByte(packageNameVer, '@')
	base.FillPreconfiguredOauth(packageNameVer[:iof], sdkSourceConnectorConfig)

	sourcePlugin := &templates.SourcePlugin{
		Package: packageNameVer,
		ID:      base.SdkSourceType,
		Type:    base.SdkSourceType,
		Config:  nil,
	}
	sourceExecutor, err := templates.NewSourceExecutor(sourcePlugin)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to init source from npm package: "+packageNameVer, err))
		return
	}
	defer sourceExecutor.Close()
	catalog, err := sourceExecutor.Catalog()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to init source from npm package: "+packageNameVer, err))
		return
	}

	c.JSON(http.StatusOK, CatalogResponse{
		StatusResponse: middleware.OKResponse(),
		Catalog:        catalog,
	})
}
