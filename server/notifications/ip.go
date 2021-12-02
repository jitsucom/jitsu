package notifications

import (
	"encoding/json"
	"io/ioutil"
	"net/http"
	"time"
)

type IPInfo struct {
	IP      string `json:"ip"`
	Country string `json:"country"`
	CC      string `json:"cc"`
}

func getIP() *IPInfo {
	client := &http.Client{
		Timeout: 2 * time.Second,
	}

	r, err := client.Get("https://api.myip.com/")
	if err != nil {
		return nil
	}

	if r.Body != nil {
		defer r.Body.Close()
	}

	b, err := ioutil.ReadAll(r.Body)
	if err != nil {
		return nil
	}

	ii := &IPInfo{}
	json.Unmarshal(b, ii)
	return ii
}
