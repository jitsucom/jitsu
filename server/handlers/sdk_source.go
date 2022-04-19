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

//SpecHandler returns sdk source spec by package name (with version)
func (ah *SdkSourceHandler) SpecHandler(c *gin.Context) {
	packageNameVer := c.Param("packageNameVer")
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
	//TODO: enrich oauth fields
	c.JSON(http.StatusOK, SpecResponse{
		StatusResponse: middleware.OKResponse(),
		Spec:           sourceExecutor.Spec(),
	})
}

//CatalogHandler returns sdk source catalog by package_name@version and config
func (ah *SdkSourceHandler) CatalogHandler(c *gin.Context) {
	packageNameVer := c.Param("packageNameVer")
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
	catalog, err := sourceExecutor.Catalog()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to init source from npm package: "+packageNameVer, err))
		return
	}

	//airbyteRunner := airbyte.NewRunner(dockerImage, imageVersion, "")
	//catalogRow, err := airbyteRunner.Discover(airbyteSourceConnectorConfig, time.Minute*3)
	//if err != nil {
	//	if err == runner.ErrNotReady {
	//		c.JSON(http.StatusOK, middleware.PendingResponse())
	//		return
	//	}
	//
	//	c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
	//	return
	//}

	c.JSON(http.StatusOK, CatalogResponse{
		StatusResponse: middleware.OKResponse(),
		Catalog:        catalog,
	})
}

//
//func enrichOathFields(dockerImage string, spec interface{}) {
//	oathFields, ok := oauth.Fields[dockerImage]
//	if ok {
//		props, err := utils.ExtractObject(spec, "connectionSpecification", "properties")
//		if err != nil {
//			logging.Errorf("failed to extract properties from spec for %s : %v", dockerImage, err)
//			return
//		}
//		propsMap, ok := props.(map[string]interface{})
//		if !ok {
//			logging.Errorf("cannot convert properties to map[string]interface{} from: %T", props)
//			return
//		}
//		specsRaw, _ := utils.ExtractObject(spec, "connectionSpecification")
//		specs := specsRaw.(map[string]interface{})
//		required, ok := specs["required"].([]interface{})
//		if !ok {
//			logging.Errorf("cannot get required properties of []interface{}. found: %T", specs["required"])
//			return
//		}
//		provided := make(map[string]bool)
//		for k, v := range oathFields {
//			pr, ok := propsMap[k]
//			if !ok {
//				continue
//			}
//			prMap, ok := pr.(map[string]interface{})
//			if !ok {
//				logging.Errorf("cannot convert property %s to map[string]interface{} from: %T", k, pr)
//				continue
//			}
//			prov := viper.GetString(v) != ""
//			prMap["env_name"] = strings.ReplaceAll(strings.ToUpper(v), ".", "_")
//			prMap["yaml_path"] = v
//			prMap["provided"] = prov
//			provided[k] = prov
//		}
//		newReq := make([]interface{}, 0, len(required)-len(provided))
//		for _, v := range required {
//			if !provided[v.(string)] {
//				newReq = append(newReq, v)
//			}
//		}
//		specs["required"] = newReq
//	}
//}
//

//
//func (ah *AirbyteHandler) getAvailableDockerVersions(dockerImageName string) ([]string, error) {
//	var tags []*DockerHubTag
//	nextURL := fmt.Sprintf(dockerHubURLTemplate, "airbyte", dockerImageName)
//	for nextURL != "" {
//		responseVersions, next, err := ah.requestDockerHubTags(nextURL)
//		if err != nil {
//			return nil, err
//		}
//		tags = append(tags, responseVersions...)
//		nextURL = next
//	}
//
//	//sort by pushed date
//	sort.Slice(tags, func(i, j int) bool {
//		a := tags[i]
//		aTime, _ := time.Parse(a.TagLastPushed, time.RFC3339Nano)
//		b := tags[j]
//		bTime, _ := time.Parse(b.TagLastPushed, time.RFC3339Nano)
//		return aTime.Before(bTime)
//	})
//
//	var versions []string
//	for _, ver := range tags {
//		if ver.Name == "latest" {
//			continue
//		}
//
//		versions = append(versions, ver.Name)
//	}
//
//	return versions, nil
//}
//
////requestDockerHubTags returns docker tags, next link or empty string
////err if occurred
//func (ah *AirbyteHandler) requestDockerHubTags(reqURL string) ([]*DockerHubTag, string, error) {
//	resp, err := ah.httpClient.Get(reqURL)
//	if err != nil {
//		if errors.Is(err, context.DeadlineExceeded) {
//			return nil, "", fmt.Errorf("timeout [%s] reached", defaultTimeout.String())
//		}
//
//		return nil, "", err
//	}
//	defer func() {
//		if resp.Body != nil {
//			resp.Body.Close()
//		}
//	}()
//
//	respBody, err := ioutil.ReadAll(resp.Body)
//	if err != nil {
//		return nil, "", fmt.Errorf("Error reading response: %v", err)
//	}
//
//	if resp.StatusCode != http.StatusOK {
//		return nil, "", fmt.Errorf("HTTP code = %d, body: %s", resp.StatusCode, string(respBody))
//	}
//
//	dhResp := &DockerHubResponse{}
//	if err := json.Unmarshal(respBody, dhResp); err != nil {
//		return nil, "", err
//	}
//
//	var tags []*DockerHubTag
//	for _, tag := range dhResp.Results {
//		tags = append(tags, tag)
//	}
//
//	return tags, dhResp.Next, nil
//}
