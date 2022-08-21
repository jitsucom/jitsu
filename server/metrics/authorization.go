package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successApiKeyUpdating *prometheus.Counter
	errorApiKeyUpdating   *prometheus.Counter

	unauthorizedAccess      *prometheus.Counter
	unauthorizedAdminAccess *prometheus.Counter
	unauthorizedTokenAccess *prometheus.Counter
)

func initAuthorization() {
	successApiKeyUpdating = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization_apiKey_updating",
			Name:      "success",
		})
	errorApiKeyUpdating = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization_apiKey_updating",
			Name:      "error",
		})

	unauthorizedAccess = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization",
			Name:      "unauthorized_access",
		})
	unauthorizedAdminAccess = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization",
			Name:      "unauthorized_admin_access",
		})
	unauthorizedTokenAccess = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization",
			Name:      "unauthorized_token_access",
		})
}

func SuccessApiKeyUpdating() {
	if Enabled() {
		(*successApiKeyUpdating).Inc()
	}
}

func ErrorApiKeyUpdating() {
	if Enabled() {
		(*errorApiKeyUpdating).Inc()
	}
}

func UnauthorizedAccess() {
	if Enabled() {
		(*unauthorizedAccess).Inc()
	}
}

func UnauthorizedTokenAccess() {
	if Enabled() {
		(*unauthorizedTokenAccess).Inc()
	}
}

func UnauthorizedAdminAccess() {
	if Enabled() {
		(*unauthorizedAdminAccess).Inc()
	}
}
