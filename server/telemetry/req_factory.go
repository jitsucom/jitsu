package telemetry

import (
	"crypto/md5"
	"fmt"
	"github.com/jitsucom/jitsu/server/timestamp"
	"net"
	"strings"
)

//RequestFactory is a factory for telemetry requests
type RequestFactory struct {
	iInfo *InstanceInfo
}

func newRequestFactory(serviceName, commit, tag, buildAt string) *RequestFactory {
	instanceID, err := getServerMacAddrHash()
	if err != nil {
		//TODO errors.New().GettingInstanceId()
		instanceID = "UNKNOWN"
	}

	return &RequestFactory{
		iInfo: &InstanceInfo{
			Id:          instanceID,
			Commit:      commit,
			Tag:         tag,
			BuiltAt:     buildAt,
			ServiceName: serviceName,
		},
	}
}

func (rf *RequestFactory) fromUsage(usage *Usage) *Request {
	return &Request{
		Timestamp:    timestamp.NowUTC(),
		InstanceInfo: rf.iInfo,
		MetricType:   "usage",
		Usage:        usage,
	}
}

func (rf *RequestFactory) fromErrors(error *Errors) *Request {
	return &Request{
		Timestamp:    timestamp.NowUTC(),
		InstanceInfo: rf.iInfo,
		MetricType:   "errors",
		Errors:       error,
	}
}

func (rf *RequestFactory) fromUser(user *UserData) *Request {
	return &Request{
		Timestamp:    timestamp.NowUTC(),
		InstanceInfo: rf.iInfo,
		MetricType:   "users",
		User:         user,
	}
}

//return hashed current server mac address
func getServerMacAddrHash() (string, error) {
	iAddresses, err := net.InterfaceAddrs()
	if err != nil {
		return "", err
	}

	var serverIpStr string
	for _, addr := range iAddresses {
		ipNet, ok := addr.(*net.IPNet)
		if ok && !ipNet.IP.IsLoopback() && ipNet.IP.To4() != nil {
			serverIpStr = ipNet.IP.String()
		}
	}

	var interfaceName string
	interfaces, _ := net.Interfaces()
	for _, i := range interfaces {
		if iAddresses, err := i.Addrs(); err == nil {
			for _, addr := range iAddresses {
				if strings.Contains(addr.String(), serverIpStr) {
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
