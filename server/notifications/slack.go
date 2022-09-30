package notifications

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jitsucom/jitsu/server/runtime"
	"github.com/jitsucom/jitsu/server/safego"
)

const (
	ServiceName         = "Jitsu-Server"
	serverStartTemplate = `{
    "text": "*%s %s* [%s] from (%s): Start",
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
    "text": "*%s %s* [%s]: System error",
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
	groupedSystemErrorTemplate = `{
    "text": "*%s %s* [%s]: System error occurred [%d] times in the last minute",
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
	client              *http.Client
	errorLoggingFunc    func(format string, v ...interface{})
	successMetricFunc   func()
	errorMetricFunc     func()
	mutex               *sync.RWMutex
	systemErrorsCounter map[string]int64

	serviceName string
	version     string
	webHookURL  string
	serverName  string

	messagesCh chan string
	flush      chan struct{}
	closed     chan struct{}
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

//startSending starts goroutine for sending messages from messagesCh
func (sn *SlackNotifier) startSending() {
	safego.RunWithRestart(func() {
		for {
			select {
			case <-sn.closed:
				return
			case message := <-sn.messagesCh:
				err := sn.Send(message)
				if err != nil {
					sn.errorMetricFunc()
					sn.errorLoggingFunc("Error notify: %v", err)
				} else {
					sn.successMetricFunc()
				}
			}
		}
	})
}

//startErrorsObserver starts a goroutine for sending grouped errors every minute
func (sn *SlackNotifier) startErrorsObserver() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-sn.closed:
				return
			case <-sn.flush:
				sn.observe()
			case <-ticker.C:
				sn.observe()
			}
		}
	})
}

//observe sends all grouped errors and clean up the counter
func (sn *SlackNotifier) observe() {
	knownSystemErrors := map[string]int64{}
	instance.mutex.Lock()
	for errPayload, count := range sn.systemErrorsCounter {
		if count > 1 {
			enqueueMessage(fmt.Sprintf(groupedSystemErrorTemplate, instance.serviceName, instance.version, instance.serverName, count, errPayload))
			//made error known. It prevents extra system error notification after group notification
			knownSystemErrors[errPayload] = 1
		}
	}

	sn.systemErrorsCounter = knownSystemErrors
	instance.mutex.Unlock()
}

func Init(serviceName, version, url, serverName string,
	errorLoggingFunc func(format string, v ...interface{}),
	successMetricFunc, errorMetricFunc func()) {

	instance = &SlackNotifier{
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		errorLoggingFunc:    errorLoggingFunc,
		mutex:               &sync.RWMutex{},
		systemErrorsCounter: map[string]int64{},
		successMetricFunc:   successMetricFunc,
		errorMetricFunc:     errorMetricFunc,
		serviceName:         serviceName,
		webHookURL:          url,
		version:             version,
		serverName:          serverName,
		messagesCh:          make(chan string, 1000),
		flush:               make(chan struct{}),
		closed:              make(chan struct{}),
	}
	instance.startSending()
	instance.startErrorsObserver()
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
		enqueueMessage(string(b))
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
		enqueueMessage(fmt.Sprintf(serverStartTemplate, instance.serviceName, instance.version, instance.serverName, ip, body))
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

		errPayload := strings.Join(valuesStr, " ")

		//increments error counter
		instance.mutex.Lock()
		instance.systemErrorsCounter[errPayload]++
		counter, _ := instance.systemErrorsCounter[errPayload]
		instance.mutex.Unlock()

		//send if an error occurred first time or it will be sent in startErrorsObserver()
		if counter == 1 {
			enqueueMessage(fmt.Sprintf(systemErrorTemplate, instance.serviceName, instance.version, instance.serverName, errPayload))
		}
	}
}

func enqueueMessage(message string) {
	if instance != nil {
		select {
		case instance.messagesCh <- message:
		default:
		}
	}
}

func Flush() {
	if instance != nil {
		select {
		case <-instance.flush:
		default:
			close(instance.flush)
		}

	}
}

func Close() {
	if instance != nil {
		select {
		case <-instance.closed:
			return
		default:
			close(instance.closed)
		}
	}
}
