package appconfig

import (
	"context"
	"github.com/google/go-github/v32/github"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/safego"
	"strings"
	"time"
)

const logTemplate = "+----------------------------+\n                            |-   EventNative by Jitsu   -|\n                            |-    New version is out!   -|\n                            |-         %s        -|\n                            +----------------------------+"

type VersionNotifier struct {
	ctx              context.Context
	client           *github.Client
	currentENVersion string

	closed bool
}

func NewVersionNotifier(ctx context.Context, tag string) *VersionNotifier {
	parts := strings.Split(tag, "-")
	tagVersion := parts[0]
	return &VersionNotifier{
		ctx:              ctx,
		client:           github.NewClient(nil),
		currentENVersion: tagVersion,
		closed:           false,
	}
}

func (vn *VersionNotifier) Start() {
	ticker := time.NewTicker(24 * time.Hour)
	safego.RunWithRestart(func() {
		for {
			if vn.closed {
				break
			}

			<-ticker.C
			rl, _, err := vn.client.Repositories.GetLatestRelease(vn.ctx, "jitsucom", "eventnative")
			if err == nil && rl != nil && rl.TagName != nil {
				newTagName := *rl.TagName
				if newTagName > vn.currentENVersion {
					for i := len(newTagName); i < 9; i++ {
						newTagName += " "
					}
					logging.Warnf(logTemplate, newTagName)
				}
			}
		}
	})
}

func (vn *VersionNotifier) Close() error {
	vn.closed = true

	return nil
}
