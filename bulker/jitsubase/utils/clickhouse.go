package utils

import (
	"fmt"
	"net/url"
	"strings"
)

// ClickhouseConfig holds the parsed ClickHouse connection configuration
type ClickhouseConfig struct {
	Host     string
	Port     string
	Username string
	Password string
	Database string
	SSL      bool
}

// ClickhouseEnvVars interface for environment variable access
type ClickhouseEnvVars interface {
	GetClickhouseURL() string
	GetClickhouseHost() string
	GetClickhouseUsername() string
	GetClickhousePassword() string
	GetClickhouseDatabase() string
	GetClickhouseSSL() bool
}

// ParseClickhouseURL parses a ClickHouse URL and extracts components.
// URL format: [protocol://][username:password@]host[:port][/database]
func ParseClickhouseURL(rawURL string) (*ClickhouseConfig, error) {
	config := &ClickhouseConfig{}

	if rawURL == "" {
		return config, nil
	}

	// Add protocol if missing to make URL parsing work
	urlToParse := rawURL
	hasProtocol := strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://")
	if !hasProtocol {
		// Check if it looks like it has credentials (contains @)
		if strings.Contains(rawURL, "@") {
			urlToParse = "https://" + rawURL
		} else {
			urlToParse = "https://" + rawURL
		}
	}

	parsed, err := url.Parse(urlToParse)
	if err != nil {
		return nil, fmt.Errorf("failed to parse ClickHouse URL: %w", err)
	}

	// Extract SSL from protocol
	if hasProtocol {
		config.SSL = parsed.Scheme == "https"
	}

	// Extract username and password
	if parsed.User != nil {
		config.Username = parsed.User.Username()
		config.Password, _ = parsed.User.Password()
	}

	// Extract host and port
	config.Host = parsed.Hostname()
	config.Port = parsed.Port()

	// Extract database from path
	if parsed.Path != "" && parsed.Path != "/" {
		config.Database = strings.TrimPrefix(parsed.Path, "/")
	}

	return config, nil
}

// GetClickhouseConfig builds ClickHouse configuration from environment variables.
// Priority:
// 1. Parse CLICKHOUSE_URL for all components
// 2. Fall back to individual env vars for missing components
// 3. Use CLICKHOUSE_SSL to determine SSL if not in URL
func GetClickhouseConfig(env ClickhouseEnvVars) (*ClickhouseConfig, error) {
	config := &ClickhouseConfig{}

	// Parse URL if provided
	clickhouseURL := env.GetClickhouseURL()
	if clickhouseURL != "" {
		parsed, err := ParseClickhouseURL(clickhouseURL)
		if err != nil {
			return nil, err
		}
		config = parsed
	}

	// Fall back to individual env vars for missing components
	if config.Username == "" {
		config.Username = NvlString(env.GetClickhouseUsername(), "default")
	}
	if config.Password == "" {
		config.Password = env.GetClickhousePassword()
	}
	if config.Database == "" {
		config.Database = env.GetClickhouseDatabase()
	}

	// Use CLICKHOUSE_SSL if SSL not determined from URL
	if clickhouseURL == "" || (!strings.HasPrefix(clickhouseURL, "http://") && !strings.HasPrefix(clickhouseURL, "https://")) {
		config.SSL = env.GetClickhouseSSL()
	}

	// Fall back to CLICKHOUSE_HOST if host not in URL
	if config.Host == "" {
		config.Host = env.GetClickhouseHost()
	}

	return config, nil
}

// GetAddr returns the address string for ClickHouse connection (host:port or just host)
func (c *ClickhouseConfig) GetAddr() string {
	if c.Port != "" {
		return c.Host + ":" + c.Port
	}
	return c.Host
}

// GetURL returns the full URL for ClickHouse HTTP connection
func (c *ClickhouseConfig) GetURL() string {
	scheme := "http"
	if c.SSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, c.GetAddr())
}
