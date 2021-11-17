package oauth

var (
	Fields = map[string]map[string]string{
		"source-bing-ads": {
			"client_id": "bing_ads.client_id",
			"client_secret": "bing_ads.client_secret",
			"developer_token": "bing_ads.developer_token",
		},
		"google_analytics": {
			"client_id": "google_analytics.client_id",
			"client_secret": "google_analytics.client_secret",
		},
	}
)
