package synchronization

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/carlmjohnson/requests"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/mitchellh/mapstructure"
	"github.com/pkg/errors"
)

type LoggedTask struct {
	*meta.Task
	*TaskLogger
	Notifications map[string]interface{}
	Status        string
}

type NotificationScene struct {
	ServiceName string
	Version     string
	ServerName  string
	UIBaseURL   string
}

type NotificationRequest struct {
	*NotificationScene
	LoggedTask
	Config interface{}
	Global bool
}

type NotificationChannel func(ctx context.Context, req *NotificationRequest) error

type NotificationService struct {
	*NotificationScene
	globalConfig map[string]interface{}
	registry     map[string]NotificationChannel
}

func NewNotificationService(scene *NotificationScene, config map[string]interface{}) *NotificationService {
	return &NotificationService{
		NotificationScene: scene,
		globalConfig:      config,
		registry: map[string]NotificationChannel{
			"slack": Slack,
		},
	}
}

func (s *NotificationService) Notify(task LoggedTask) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for key, value := range task.Notifications {
		if err := s.notify(ctx, key, value, false, task); err != nil {
			logging.Warnf("[%s] Failed to notify %s: %s", task.ID, key, err)
		}

		if ctx.Err() != nil {
			return
		}
	}

	for key, value := range s.globalConfig {
		if err := s.notify(ctx, key, value, true, task); err != nil {
			logging.Warnf("[%s] Failed to notify global %s: %s", task.ID, key, err)
		}

		if ctx.Err() != nil {
			return
		}
	}
}

func (s *NotificationService) notify(ctx context.Context, key string, config interface{}, global bool, task LoggedTask) error {
	notify, ok := s.registry[key]
	if !ok {
		return errors.New("unsupported notification channel")
	}

	return notify(ctx, &NotificationRequest{
		NotificationScene: s.NotificationScene,
		LoggedTask:        task,
		Config:            config,
		Global:            global,
	})
}

type Map map[string]interface{}

const (
	green = "#5cb85c"
	red   = "#d9534f"
	grey  = "#808080"
)

var Slack NotificationChannel = func(ctx context.Context, req *NotificationRequest) error {
	var config struct {
		URL string `mapstructure:"url"`
	}

	if err := mapstructure.Decode(req.Config, &config); err != nil {
		return errors.Wrapf(err, "decode config: %+v", req.Config)
	}

	config.URL = strings.Trim(config.URL, " \n\t")

	if config.URL == "" {
		// disabled
		return nil
	}

	projectText := ""
	sourceID := req.Source
	if dot := strings.Index(sourceID, "."); dot >= 0 && dot < len(sourceID)-1 {
		if req.Global {
			projectText = fmt.Sprintf("*Project*: %s\n", sourceID[:dot])
		}

		sourceID = sourceID[dot+1:]
	}

	var source, logs string
	if req.UIBaseURL != "" && !req.Global {
		source = fmt.Sprintf("<%s/sources/edit/%s|%s>", req.UIBaseURL, sourceID, sourceID)
		logs = fmt.Sprintf("<%s/sources/logs/%s/%s|See logs>", req.UIBaseURL, sourceID, req.Task.ID)
	} else {
		source = sourceID
		logs = "*Logs:*\n" + strings.Join(req.TaskLogger.Collect(), "\n")
	}

	if req.Status == SUCCESS.String() {
		logs = ""
	}

	color := grey
	switch req.Status {
	case SUCCESS.String():
		color = green
	case FAILED.String():
		color = red
	}

	return requests.URL(config.URL).
		Method(http.MethodPost).
		BodyJSON(Map{
			"text": fmt.Sprintf("*%s %s* [%s]: Synchronization %s", req.ServiceName, req.Version, req.ServerName, req.Status),
			"attachments": []Map{{
				"color": color,
				"blocks": []Map{
					{
						"type": "divider",
					},
					{
						"type": "section",
						"text": Map{
							"type": "mrkdwn",
							"text": fmt.Sprintf("%s*Connector type:* %s\n*Connector:* %s\n*Collection:* %s\n%s",
								projectText, req.SourceType, source, req.Collection, logs),
						},
					},
				},
			}},
		}).
		CheckStatus(http.StatusOK).
		Fetch(ctx)
}
