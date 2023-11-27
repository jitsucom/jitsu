package telemetry

import (
	"crypto/md5"
	"fmt"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"net"
	"runtime"
	"strings"
)

const (
	usageMetricType  = "usage"
	errorsMetricType = "errors"
	usersMetricType  = "users"
)

//RequestFactory is a factory for telemetry requests
type RequestFactory struct {
	dockerHubID string
	iInfo       *InstanceInfo
}

func newRequestFactory(serviceName, commit, tag, buildAt, dockerHubID string) *RequestFactory {
	instanceID, err := getServerMacAddrHash()
	if err != nil {
		//TODO errors.New().GettingInstanceID()
		instanceID = "UNKNOWN"
	}

	return &RequestFactory{
		dockerHubID: dockerHubID,
		iInfo: &InstanceInfo{
			ID:          instanceID,
			Commit:      commit,
			Tag:         tag,
			BuiltAt:     buildAt,
			Arch:        runtime.GOARCH,
			ServiceName: serviceName,
			RunID:       uuid.New(),
		},
	}
}

func (rf *RequestFactory) fromUsage(usage *Usage) *Request {
	usage.DockerHubID = rf.dockerHubID
	return &Request{
		Timestamp:    timestamp.NowUTC(),
		InstanceInfo: rf.iInfo,
		MetricType:   usageMetricType,
		Usage:        usage,
	}
}

func (rf *RequestFactory) fromErrors(error *Errors) *Request {
	return &Request{
		Timestamp:    timestamp.NowUTC(),
		InstanceInfo: rf.iInfo,
		MetricType:   errorsMetricType,
		Errors:       error,
	}
}

func (rf *RequestFactory) fromUser(user *UserData) *Request {
	return &Request{
		Timestamp:    timestamp.NowUTC(),
		InstanceInfo: rf.iInfo,
		MetricType:   usersMetricType,
		User:         user,
	}
}

//return hashed current server mac address
func getServerMacAddrHash() (string, error) {
	iAddresses, err := net.InterfaceAddrs()
	if err != nil {
		return "", err
	}

	var serverIPStr string
	for _, addr := range iAddresses {
		ipNet, ok := addr.(*net.IPNet)
		if ok && !ipNet.IP.IsLoopback() && ipNet.IP.To4() != nil {
			serverIPStr = ipNet.IP.String()
		}
	}

	var interfaceName string
	interfaces, _ := net.Interfaces()
	for _, i := range interfaces {
		if iAddresses, err := i.Addrs(); err == nil {
			for _, addr := range iAddresses {
				if strings.Contains(addr.String(), serverIPStr) {
					interfaceName = i.Name
				}
			}
		}
	}

	currentNetInterface, err := net.InterfaceByName(interfaceName)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", md5.Sum([]byte(currentNetInterface.HardwareAddr.String()))), nil
}
