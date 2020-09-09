package events

import (
	"errors"
	"fmt"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/geo"
	"github.com/ksensehq/eventnative/useragent"
	"log"
	"net/http"
	"strings"
)

const eventnKey = "eventn_ctx"
const uaKey = "user_agent"

var nilFactErr = errors.New("Input fact can't be nil")

type Preprocessor interface {
	Preprocess(fact Fact, r *http.Request) (Fact, error)
}

//C2SPreprocessor preprocess client 2 server integration events
type C2SPreprocessor struct {
	geoResolver geo.Resolver
	uaResolver  useragent.Resolver
}

func NewC2SPreprocessor() Preprocessor {
	return &C2SPreprocessor{
		geoResolver: appconfig.Instance.GeoResolver,
		uaResolver:  appconfig.Instance.UaResolver,
	}
}

//Preprocess resolve geo from ip headers or remoteAddr
//resolve useragent from uaKey
//put data to eventnKey
//return same object
func (c2sp *C2SPreprocessor) Preprocess(fact Fact, r *http.Request) (Fact, error) {
	if fact == nil {
		return nil, nilFactErr
	}

	ip := extractIp(r)

	eventnObject, ok := fact[eventnKey]
	if !ok {
		return nil, fmt.Errorf("Unable to get %s from %v", eventnKey, fact)
	}

	eventFact, ok := eventnObject.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("Unable to cast %s to object: %v", eventnKey, eventnObject)
	}

	geoData, err := c2sp.geoResolver.Resolve(ip)
	if err != nil {
		log.Println(err)
	}

	//geo
	eventFact[geo.GeoDataKey] = geoData

	//user agent
	ua, ok := eventFact[uaKey]
	if ok {
		if uaStr, ok := ua.(string); ok {
			eventFact[useragent.ParsedUaKey] = c2sp.uaResolver.Resolve(uaStr)
		}
	}

	return fact, nil
}

func extractIp(r *http.Request) string {
	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip = r.Header.Get("X-Forwarded-For")
	}
	if ip == "" {
		remoteAddr := r.RemoteAddr
		if remoteAddr != "" {
			addrPort := strings.Split(remoteAddr, ":")
			ip = addrPort[0]
		}
	}
	return ip
}
