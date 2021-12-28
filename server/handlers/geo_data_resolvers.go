package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

//GeoDataResolverTestRequest is a dto for test endpoint request
type GeoDataResolverTestRequest struct {
	MaxMindURL string `json:"maxmind_url"`
}

//GeoDataResolverTestResponse is a dto for test endpoint response
type GeoDataResolverTestResponse struct {
	middleware.StatusResponse

	Editions []*geo.EditionRule `json:"editions"`
}

//GeoDataResolverHandler is responsible for testing maxmind connection
type GeoDataResolverHandler struct {
	service *geo.Service
}

//NewGeoDataResolverHandler returns configured handler
func NewGeoDataResolverHandler(service *geo.Service) *GeoDataResolverHandler {
	return &GeoDataResolverHandler{
		service: service,
	}
}

//TestHandler validates geo data resolver connection
func (gdrh *GeoDataResolverHandler) TestHandler(c *gin.Context) {
	geoTestRequest := &GeoDataResolverTestRequest{}
	if err := c.BindJSON(geoTestRequest); err != nil {
		logging.Errorf("Error parsing geo data resolver body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	if geoTestRequest.MaxMindURL == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("maxmind_url is required parameter in JSON body", nil))
		return
	}

	editionsWithStatuses, err := gdrh.service.TestGeoResolver(geoTestRequest.MaxMindURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	response := &GeoDataResolverTestResponse{
		StatusResponse: middleware.OKResponse(),
		Editions:       editionsWithStatuses,
	}

	c.JSON(http.StatusOK, response)
}

//EditionsHandler returns all supported geo data resolvers editions
func (gdrh *GeoDataResolverHandler) EditionsHandler(c *gin.Context) {
	paidEditions := gdrh.service.GetPaidEditions()
	var editions []*geo.EditionRule

	for _, edition := range paidEditions {
		rule := &geo.EditionRule{
			Main: &geo.EditionData{
				Name:   edition,
				Status: geo.StatusUnknown,
			},
		}

		analog := edition.FreeAnalog()
		if analog != geo.Unknown && analog != geo.NotRequired {
			rule.Analog = &geo.EditionData{
				Name:   analog,
				Status: geo.StatusUnknown,
			}
		}

		editions = append(editions, rule)
	}

	c.JSON(http.StatusOK, &GeoDataResolverTestResponse{
		StatusResponse: middleware.OKResponse(),
		Editions:       editions,
	})
}
