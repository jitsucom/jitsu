package notifications

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/runtime"
	"github.com/jitsucom/jitsu/server/safego"
	"io/ioutil"
	"net/http"
	"strings"
	"time"
)

const (
	ServiceName         = "Jitsu-Server"
	serverStartTemplate = `{
    "text": "*%s* [%s] from (%s): Start",
	"attachments": [
		{
			"color": "#5cb85c",
			"blocks": [
				{
					"type": "divider"
				},
				{
					"type": "section",
					"text": {
						"type": "mrkdwn",
						"text": "%s"
					}
				}
			]
		}
	]
}`
	systemErrorTemplate = `{
    "text": "*%s* [%s]: System error",
	"attachments": [
		{
			"color": "#d9534f",
			"blocks": [
				{
					"type": "divider"
				},
				{
					"type": "section",
					"text": {
						"type": "mrkdwn",
						"text": "%s"
					}
				}
			]
		}
	]
}`
)

var instance *SlackNotifier

type SlackMessage struct {
	Text        string       `json:"text,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
}

type Attachment struct {
	Blocks []Block `json:"blocks,omitempty"`
}

type Block struct {
	Type string `json:"type,omitempty"`
	Text *Text  `json:"text,omitempty"`
}

type Text struct {
	Type string `json:"type,omitempty"`
	Text string `json:"text,omitempty"`
}

type SlackNotifier struct {
	client           *http.Client
	errorLoggingFunc func(format string, v ...interface{})
	serviceName      string
	webHookURL       string
	serverName       string

	messagesCh chan string
	closed     bool
}

func (sn *SlackNotifier) Send(payload string) error {
	resp, err := sn.client.Post(sn.webHookURL, "application/json", bytes.NewBufferString(payload))
	if err != nil {
		return fmt.Errorf("Error sending slack http request: %v", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		respBytes, err := ioutil.ReadAll(resp.Body)
		return fmt.Errorf("Error slack http response code: %d body: %s reading error: %v", resp.StatusCode, string(respBytes), err)
	}

	return nil
}

func (sn *SlackNotifier) start() {
	safego.RunWithRestart(func() {
		for {
			if sn.closed {
				break
			}

			message := <-sn.messagesCh
			err := sn.Send(message)
			if err != nil {
				sn.errorLoggingFunc("Error notify: %v", err)
			}
		}
	})
}

func Init(serviceName, url, serverName string, errorLoggingFunc func(format string, v ...interface{})) {
	instance = &SlackNotifier{
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		errorLoggingFunc: errorLoggingFunc,
		serviceName:      serviceName,
		webHookURL:       url,
		serverName:       serverName,
		messagesCh:       make(chan string, 1000),
	}
	instance.start()
}

func Custom(payload string) {
	if instance != nil {
		sm := &SlackMessage{
			Text: "Custom Notification",
			Attachments: []Attachment{
				{
					Blocks: []Block{
						{
							Type: "divider",
						},
						{
							Type: "section",
							Text: &Text{
								Type: "mrkdwn",
								Text: "```" + payload + "```",
							},
						},
					},
				},
			}}
		b, _ := json.Marshal(sm)
		instance.messagesCh <- string(b)
	}
}

func ServerStart(systemInfo *runtime.Info) {
	if instance != nil {
		ipInfo := getIP()
		ip := "unknown"
		if ipInfo != nil {
			if ipInfo.IP != "" {
				ip = ipInfo.IP
			}
		}

		systemInfoStr := "unknown system info"
		if systemInfo != nil {
			systemInfoStr = fmt.Sprintf("RAM used: %s | RAM total: %.2f GB | CPU cores: %d", systemInfo.RAMUsage, systemInfo.RAMTotalGB, systemInfo.CPUCores)
		}

		body := fmt.Sprintf("Service [%s] has been started!", systemInfoStr)
		instance.messagesCh <- fmt.Sprintf(serverStartTemplate, instance.serviceName, instance.serverName, ip, body)
	}
}

func SystemErrorf(format string, v ...interface{}) {
	SystemError(fmt.Sprintf(format, v...))
}

func SystemError(msg ...interface{}) {
	if instance != nil {
		var valuesStr []string
		for _, v := range msg {
			valuesStr = append(valuesStr, fmt.Sprint(v))
		}
		instance.messagesCh <- fmt.Sprintf(systemErrorTemplate, instance.serviceName, instance.serverName, strings.Join(valuesStr, " "))
	}
}

func Close() {
	if instance != nil {
		instance.closed = true
	}
}
