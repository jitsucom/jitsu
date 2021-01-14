package appconfig

import (
	"context"
	"github.com/google/go-github/v32/github"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/safego"
	"regexp"
	"strings"
	"time"
)

//2020-11-12 19:16:13 [WARN]: +--------------------------------+
//                            |-     EventNative by Jitsu     -|
//                            |-      New version is out!     -|
//                            |-          v1.25.10            -|
//                            +--------------------------------+
const logTemplate = "+--------------------------------+\n                            |-     EventNative by Jitsu     -|\n                            |-      New version is out!     -|\n                            |-         %s        -|\n                            +--------------------------------+"

var VersionRegex = regexp.MustCompile(`v(\d\.\d\d?)[-|\.](beta)?(\d?\d?)`)

type VersionReminder struct {
	ctx    context.Context
	client *github.Client

	closed bool
}

func NewVersionReminder(ctx context.Context) *VersionReminder {
	return &VersionReminder{
		ctx:    ctx,
		client: github.NewClient(nil),
		closed: false,
	}
}

func (vn *VersionReminder) Start() {
	ticker := time.NewTicker(24 * time.Hour)
	safego.RunWithRestart(func() {
		for {
			if vn.closed {
				break
			}

			<-ticker.C
			releasesList, _, err := vn.client.Repositories.ListReleases(context.Background(), "jitsucom", "eventnative", &github.ListOptions{Page: 0, PerPage: 100})
			if err != nil {
				continue
			}

			for _, rl := range releasesList {
				if rl != nil && rl.TagName != nil {
					//compare beta and stable releases separately
					if (Beta && !strings.Contains(*rl.TagName, "beta")) ||
						(!Beta && strings.Contains(*rl.TagName, "beta")) {
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
							newTagName += " "
						}
						logging.Warnf(logTemplate, newTagName)
					}

					//only first element in the array (last release version) is compared
					break
				}
			}
		}
	})
}

func (vn *VersionReminder) Close() error {
	vn.closed = true

	return nil
}
