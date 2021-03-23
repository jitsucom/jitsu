package notifications

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/safego"
	"io/ioutil"
	"net/http"
	"strings"
	"time"
)

const (
	ServiceName         = "Jitsu-Server"
	serverStartTemplate = `{
    "text": "*%s* [%s]: Start",
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

type SlackNotifier struct {
	client           *http.Client
	errorLoggingFunc func(format string, v ...interface{})
	serviceName      string
	webHookUrl       string
	serverName       string

	messagesCh chan string
	closed     bool
}

func (sn *SlackNotifier) Send(payload string) error {
	resp, err := sn.client.Post(sn.webHookUrl, "application/json", bytes.NewBufferString(payload))
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
		webHookUrl:       url,
		serverName:       serverName,
		messagesCh:       make(chan string, 1000),
	}
	instance.start()
}

func ServerStart() {
	if instance != nil {
		instance.messagesCh <- fmt.Sprintf(serverStartTemplate, instance.serviceName, instance.serverName, "Service has been started!")
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
