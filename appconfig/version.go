package appconfig

import (
	"context"
	"github.com/google/go-github/v32/github"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/safego"
	"strings"
	"time"
)

//2020-11-12 19:16:13 [WARN]: +----------------------------+
//                            |-   EventNative by Jitsu   -|
//                            |-    New version is out!   -|
//                            |-         v1.18.0          -|
//                            +----------------------------+
const logTemplate = "+----------------------------+\n                            |-   EventNative by Jitsu   -|\n                            |-    New version is out!   -|\n                            |-         %s        -|\n                            +----------------------------+"

type VersionReminder struct {
	ctx              context.Context
	client           *github.Client
	currentENVersion string

	closed bool
}

func NewVersionReminder(ctx context.Context, tag string) *VersionReminder {
	parts := strings.Split(tag, "-")
	tagVersion := parts[0]
	return &VersionReminder{
		ctx:              ctx,
		client:           github.NewClient(nil),
		currentENVersion: tagVersion,
		closed:           false,
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
			rl, _, err := vn.client.Repositories.GetLatestRelease(vn.ctx, "jitsucom", "eventnative")
			if err == nil && rl != nil && rl.TagName != nil {
				newTagName := *rl.TagName
				if newTagName > vn.currentENVersion {
					//banner format expects version 9 letters for correct formatting
					for i := len(newTagName); i < 9; i++ {
						newTagName += " "
					}
					logging.Warnf(logTemplate, newTagName)
				}
			}
		}
	})
}

func (vn *VersionReminder) Close() error {
	vn.closed = true

	return nil
}
