package appconfig

import (
	"context"
	"github.com/google/go-github/v32/github"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"regexp"
	"strings"
	"time"
)

//2020-11-12 19:16:13 [WARN]: +--------------------------------+
//                            |-     EventNative by Jitsu     -|
//                            |-      New version is out!     -|
//                            |-          v1.25.10            -|
//                            +--------------------------------+
const logTemplate = "+--------------------------------+\n                            |-          Jitsu Server        -|\n                            |-      New version is out!     -|\n                            |-         %s        -|\n                            +--------------------------------+"

var VersionRegex = regexp.MustCompile(`v(\d\.\d\d?)[-|\.](beta)?(\d?\d?)`)

type VersionReminder struct {
	ctx    context.Context
	client *github.Client

	closed chan struct{}
}

func NewVersionReminder(ctx context.Context) *VersionReminder {
	return &VersionReminder{
		ctx:    ctx,
		client: github.NewClient(nil),
		closed: make(chan struct{}),
	}
}

func (vn *VersionReminder) Start() {
	//don't show reminder if Beta
	if Beta {
		return
	}

	ticker := time.NewTicker(24 * time.Hour)
	safego.RunWithRestart(func() {
		for {
			select {
			case <-vn.closed:
				return
			case <-ticker.C:
				vn.showReminder()
			}
		}
	})
}

func (vn *VersionReminder) showReminder() {
	releasesList, _, err := vn.client.Repositories.ListReleases(context.Background(), "jitsucom", "jitsu", &github.ListOptions{Page: 0, PerPage: 100})
	if err != nil {
		return
	}

	for _, rl := range releasesList {
		if rl != nil && rl.TagName != nil {
			//skip old beta releases
			if strings.Contains(*rl.TagName, "beta") {
				continue
			}

			parsedNewTag := VersionRegex.FindStringSubmatch(*rl.TagName)
			//malformed
			if len(parsedNewTag) != 4 {
				break
			}

			if parsedNewTag[1] > MajorVersion || (parsedNewTag[1] > MajorVersion && parsedNewTag[3] > MinorVersion) {
				//banner format expects version 13 letters for correct formatting (e.g. v1.XX-betaYY)
				newTagName := parsedNewTag[0]
				for i := len(newTagName); i < 13; i++ {
					if i%2 == 0 {
						newTagName += " "
					} else {
						newTagName = " " + newTagName
					}
				}
				logging.Warnf(logTemplate, newTagName)
			}

			//only first element in the array (last release version) is compared
			break
		}
	}
}

func (vn *VersionReminder) Close() error {
	close(vn.closed)

	return nil
}
