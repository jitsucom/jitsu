package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/oauth"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/spf13/viper"
	"io/ioutil"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	dockerHubURLTemplate = "https://hub.docker.com/v2/repositories/%s/%s/tags?page_size=1000"
	defaultTimeout       = 40 * time.Second
)

//DockerHubResponse is a DockerHub tags response dto
type DockerHubResponse struct {
	Next    string          `json:"next"`
	Results []*DockerHubTag `json:"results"`
}

//DockerHubTag is a DockerHub tags dto
type DockerHubTag struct {
	Name          string `json:"name"`
	TagLastPushed string `json:"tag_last_pushed"`
}

type VersionsResponse struct {
	Versions []string `json:"versions"`
}

type SpecResponse struct {
	middleware.StatusResponse

	Spec interface{} `json:"spec"`
}

type CatalogResponse struct {
	middleware.StatusResponse

	Catalog interface{} `json:"catalog"`
}

type AirbyteHandler struct {
	httpClient *http.Client
}

func NewAirbyteHandler() *AirbyteHandler {
	return &AirbyteHandler{httpClient: &http.Client{Timeout: defaultTimeout}}
}

//VersionsHandler requests available docker version from DockerHub and returns them by docker image name
func (ah *AirbyteHandler) VersionsHandler(c *gin.Context) {
	dockerImage := c.Param("dockerImageName")
	if dockerImage == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("docker image name is required path parameter", nil))
		return
	}

	sortedAvailableTagsVersions, err := ah.getAvailableDockerVersions(dockerImage)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("error getting available docker image [%s] versions from DockerHub: %v", dockerImage, err), nil))
		return
	}

	if len(sortedAvailableTagsVersions) == 0 {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("Docker Image %s doesn't have availabe tag on hub.docker.com", dockerImage), nil))
		return
	}

	c.JSON(http.StatusOK, VersionsResponse{
		Versions: sortedAvailableTagsVersions,
	})
}

//SpecHandler returns airbyte spec by docker name
func (ah *AirbyteHandler) SpecHandler(c *gin.Context) {
	dockerImage := c.Param("dockerImageName")
	if dockerImage == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("docker image name is required path parameter", nil))
		return
	}

	imageVersion := c.Query("image_version")
	if imageVersion == "" {
		imageVersion = airbyte.LatestVersion
	}

	airbyteRunner := airbyte.NewRunner("SpecHandler", dockerImage, imageVersion, "")
	spec, err := airbyteRunner.Spec()
	if err != nil {
		if err == runner.ErrNotReady {
			c.JSON(http.StatusOK, middleware.PendingResponse())
			return
		}

		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}
	row, ok := spec.(*airbyte.Row)
	if !ok {
		logging.Errorf("spec of unexpected type %T for: %s:%s", spec, dockerImage, imageVersion)
	} else {
		enrichOathFields(dockerImage, row.Spec)
	}
	c.JSON(http.StatusOK, SpecResponse{
		StatusResponse: middleware.OKResponse(),
		Spec:           spec,
	})
}

func enrichOathFields(dockerImage string, spec interface{}) {
	oathFields, ok := oauth.Fields[dockerImage]
	if ok {
		props, err := utils.ExtractObject(spec, "connectionSpecification", "properties")
		if err != nil {
			logging.Errorf("failed to extract properties from spec for %s : %v", dockerImage, err)
			return
		}
		propsMap, ok := props.(map[string]interface{})
		if !ok {
			logging.Errorf("cannot convert properties to map[string]interface{} from: %T", props)
			return
		}
		specsRaw, _ := utils.ExtractObject(spec, "connectionSpecification")
		specs := specsRaw.(map[string]interface{})
		required, ok := specs["required"].([]interface{})
		if !ok {
			logging.Errorf("cannot get required properties of []interface{}. found: %T", specs["required"])
			return
		}
		provided := make(map[string]bool)
		for k, v := range oathFields {
			pr, ok := propsMap[k]
			if !ok {
				continue
			}
			prMap, ok := pr.(map[string]interface{})
			if !ok {
				logging.Errorf("cannot convert property %s to map[string]interface{} from: %T", k, pr)
				continue
			}
			prov := viper.GetString(v) != ""
			prMap["env_name"] = strings.ReplaceAll(strings.ToUpper(v), ".", "_")
			prMap["yaml_path"] = v
			prMap["provided"] = prov
			provided[k] = prov
		}
		newReq := make([]interface{}, 0, len(required)-len(provided))
		for _, v := range required {
			if !provided[v.(string)] {
				newReq = append(newReq, v)
			}
		}
		specs["required"] = newReq
	}
}

//CatalogHandler returns airbyte catalog by docker name and config
func (ah *AirbyteHandler) CatalogHandler(c *gin.Context) {
	dockerImage := c.Param("dockerImageName")
	if dockerImage == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("docker image name is required path parameter", nil))
		return
	}

	airbyteSourceConnectorConfig := map[string]interface{}{}
	if err := c.BindJSON(&airbyteSourceConnectorConfig); err != nil {
		logging.Errorf("Error parsing airbyte source connector body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	base.FillPreconfiguredOauth(dockerImage, airbyteSourceConnectorConfig)

	imageVersion := c.Query("image_version")
	if imageVersion == "" {
		imageVersion = airbyte.LatestVersion
	}

	airbyteRunner := airbyte.NewRunner("CatalogHandler", dockerImage, imageVersion, "")
	catalogRow, err := airbyteRunner.Discover(airbyteSourceConnectorConfig, time.Minute*3)
	if err != nil {
		if err == runner.ErrNotReady {
			c.JSON(http.StatusOK, middleware.PendingResponse())
			return
		}

		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, CatalogResponse{
		StatusResponse: middleware.OKResponse(),
		Catalog:        catalogRow,
	})
}

func (ah *AirbyteHandler) getAvailableDockerVersions(dockerImageName string) ([]string, error) {
	var tags []*DockerHubTag
	nextURL := fmt.Sprintf(dockerHubURLTemplate, "airbyte", dockerImageName)
	for nextURL != "" {
		responseVersions, next, err := ah.requestDockerHubTags(nextURL)
		if err != nil {
			return nil, err
		}
		tags = append(tags, responseVersions...)
		nextURL = next
	}

	//sort by pushed date
	sort.Slice(tags, func(i, j int) bool {
		a := tags[i]
		aTime, _ := time.Parse(a.TagLastPushed, time.RFC3339Nano)
		b := tags[j]
		bTime, _ := time.Parse(b.TagLastPushed, time.RFC3339Nano)
		return aTime.Before(bTime)
	})

	var versions []string
	for _, ver := range tags {
		if ver.Name == "latest" {
			continue
		}

		versions = append(versions, ver.Name)
	}

	return versions, nil
}

//requestDockerHubTags returns docker tags, next link or empty string
//err if occurred
func (ah *AirbyteHandler) requestDockerHubTags(reqURL string) ([]*DockerHubTag, string, error) {
	resp, err := ah.httpClient.Get(reqURL)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, "", fmt.Errorf("timeout [%s] reached", defaultTimeout.String())
		}

		return nil, "", err
	}
	defer func() {
		if resp.Body != nil {
			resp.Body.Close()
		}
	}()

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("Error reading response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("HTTP code = %d, body: %s", resp.StatusCode, string(respBody))
	}

	dhResp := &DockerHubResponse{}
	if err := json.Unmarshal(respBody, dhResp); err != nil {
		return nil, "", err
	}

	var tags []*DockerHubTag
	for _, tag := range dhResp.Results {
		tags = append(tags, tag)
	}

	return tags, dhResp.Next, nil
}
