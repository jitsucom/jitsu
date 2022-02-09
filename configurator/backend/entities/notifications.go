package entities

type SlackNotifications struct {
	URL string `json:"url" firebase:"url"`
}

type Notifications struct {
	Slack SlackNotifications `json:"slack" firebase:"slack"`
}
