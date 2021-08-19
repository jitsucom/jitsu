package test

import (
	"net"
	"strconv"
)

//Integration is a struct for running Integration tests
type Integration struct {
	Name             string
	ReqUrn           string
	ReqBodyPath      string
	ExpectedJSONPath string
	XAuthToken       string

	ExpectedHTTPCode     int
	ExpectedErrMsg       string
	ExpectedDeleteCookie bool
}

//GetLocalAuthority returns host:port of local server
func GetLocalAuthority() (string, error) {
	addr, err := net.ResolveTCPAddr("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return "", err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).IP.String() + ":" + strconv.Itoa(l.Addr().(*net.TCPAddr).Port), nil
}
