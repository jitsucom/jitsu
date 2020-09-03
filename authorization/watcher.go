package authorization

import (
	"crypto/md5"
	"fmt"
	"github.com/spf13/viper"
	"time"
)

func Watcher(service *Service, url string, reloadSec int) {
	hashes := map[string]string{}
	for {

		fmt.Sprintf("%x", md5.Sum())
		service.reload()
		time.Sleep(time.Duration(viper.GetInt("server.auth_reload_sec")) * time.Second)
	}
}
