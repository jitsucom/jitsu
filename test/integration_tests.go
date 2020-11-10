package test

import (
	"net"
	"strconv"
)

type IntegrationTest struct {
	Name             string
	ReqUrn           string
	ReqOrigin        string
	ReqBodyPath      string
	ExpectedJsonPath string
	XAuthToken       string

	ExpectedHttpCode int
	ExpectedErrMsg   string
}

func GetLocalAuthority() (string, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
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
