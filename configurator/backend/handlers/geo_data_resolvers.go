package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/storages"
	jgeo "github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"strings"
	"time"
)

type GeoDataResolversHandler struct {
	configurationsService *storages.ConfigurationsService
}

func NewGeoDataResolversHandler(configurationsService *storages.ConfigurationsService) *GeoDataResolversHandler {
	return &GeoDataResolversHandler{
		configurationsService: configurationsService,
	}
}

func (gdrh *GeoDataResolversHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	geoDataResolversMap, err := gdrh.configurationsService.GetGeoDataResolvers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse(DestinationsGettingErrMsg, err))
		return
	}

	idConfig := map[string]*jgeo.ResolverConfig{}
	for projectID, geoDataResolverConfig := range geoDataResolversMap {
		if geoDataResolverConfig.MaxMind != nil && geoDataResolverConfig.MaxMind.Enabled {
			maxmindURL := geoDataResolverConfig.MaxMind.LicenseKey
			if !strings.HasPrefix(maxmindURL, jgeo.MaxmindPrefix) {
				maxmindURL = jgeo.MaxmindPrefix + maxmindURL
			}
			idConfig[projectID] = &jgeo.ResolverConfig{
				Type:   jgeo.MaxmindType,
				Config: jgeo.MaxMindConfig{MaxMindURL: maxmindURL},
			}
		}
	}

	logging.Debugf("Geo data resolvers response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &jgeo.Payload{GeoResolvers: idConfig})
}

func (gdrh *GeoDataResolversHandler) TestHandler(c *gin.Context) {
	begin := time.Now()
	geoDataResolversMap, err := gdrh.configurationsService.GetGeoDataResolvers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse(DestinationsGettingErrMsg, err))
		return
	}

	idConfig := map[string]*jgeo.ResolverConfig{}
	for projectID, geoDataResolverConfig := range geoDataResolversMap {
		if geoDataResolverConfig.MaxMind != nil && geoDataResolverConfig.MaxMind.Enabled {
			maxmindURL := geoDataResolverConfig.MaxMind.LicenseKey
			if !strings.HasPrefix(maxmindURL, jgeo.MaxmindPrefix) {
				maxmindURL = jgeo.MaxmindPrefix + maxmindURL
			}
			idConfig[projectID] = &jgeo.ResolverConfig{
				Type:   jgeo.MaxmindType,
				Config: jgeo.MaxMindConfig{MaxMindURL: maxmindURL},
			}
		}
	}

	logging.Debugf("Geo data resolvers response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &jgeo.Payload{GeoResolvers: idConfig})
}
