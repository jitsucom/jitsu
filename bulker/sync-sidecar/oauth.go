package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
)

// oauth-refresh subcommand. Run as init container in the autonomous sync Pod
// template; always executes (pass-through for non-OAuth services), so the
// rest of the Pod's containers always read /shared/config.json.
//
// For OAuth-authorized services, this is the autonomous-mode equivalent of
// the console's tryManageOauthCreds (webapps/console/lib/server/oauth/services.ts).
// Tokens stored in the per-CronJob Secret get stale between scheduled runs;
// this init refreshes them via Nango at the moment the sync starts so the
// source connector always has a fresh access token.
//
// Required env: PACKAGE, FROM_ID, NANGO_API_HOST, NANGO_SECRET_KEY.
// Optional env: GOOGLE_ADS_DEVELOPER_TOKEN (only for airbyte/source-google-ads).
//
// Failure modes:
//   - config.authorized != true              → pass-through copy
//   - NANGO env unset                        → pass-through with warning (caller
//                                              accepts the staleness window)
//   - Unknown package                        → pass-through with warning
//   - Nango RPC failure                      → exit 1; CronJob fails this run
//   - Per-package merge logic error          → exit 1

// File layout for the autonomous CronJob Pod template:
//
//	/config/                         (Secret mount, read-only)
//	  serviceConfig.json              ← Jitsu service config wrapper:
//	                                    {package, version, authorized, credentials}
//	  destinationConfig.json          ← persisted destination config
//
//	/shared/                         (emptyDir, read-write)
//	  config.json                     ← unwrapped airbyte config (this init writes it):
//	                                    serviceConfig.credentials, with OAuth tokens
//	                                    refreshed for OAuth-authorized services. This
//	                                    is what the source connector reads via --config.
//	  destinationConfig.json          ← copied from /config by this init
//	  catalog.json                    ← written by load-catalog-state init
//	  state.json                      ← written by load-catalog-state init
//	  discover.jsonl                  ← (optional) written by discover init
//
// Downstream containers read everything from /shared (single CONFIGS_PATH
// for the sidecar; source connector reads /shared/config.json directly).
const (
	configInDir   = "/config"
	configOutDir  = "/shared"
	configInPath  = configInDir + "/serviceConfig.json"
	configOutPath = configOutDir + "/config.json"
	destInPath    = configInDir + "/destinationConfig.json"
	destOutPath   = configOutDir + "/destinationConfig.json"
	jitsuManaged  = "JITSU_MANAGED"
)

func runOAuthRefresh() {
	// Always shuttle destinationConfig.json from the Secret mount to /shared
	// so the sidecar can read everything from a single CONFIGS_PATH directory.
	// Best-effort — if it's not present (rare misconfiguration), the sidecar
	// will surface a clearer "destination config file ... doesn't exist" error.
	if dest, err := os.ReadFile(destInPath); err != nil {
		logging.Warnf("[oauth] reading %s: %v (sidecar will fail later)", destInPath, err)
	} else if err := os.WriteFile(destOutPath, dest, 0o644); err != nil {
		logging.Errorf("[oauth] writing %s: %v", destOutPath, err)
		os.Exit(1)
	}

	in, err := os.ReadFile(configInPath)
	if err != nil {
		logging.Errorf("[oauth] reading %s: %v", configInPath, err)
		os.Exit(2)
	}

	var cfg map[string]any
	if err := json.Unmarshal(in, &cfg); err != nil {
		logging.Errorf("[oauth] parsing %s: %v", configInPath, err)
		os.Exit(2)
	}

	authorized, _ := cfg["authorized"].(bool)
	if !authorized {
		// Non-OAuth source — write what scheduleSync's tryManageOauthCreds
		// would return: just service.credentials (the airbyte source's
		// expected wire-shape config).
		//
		// Sources like airbyte/source-postgres expect host/port/etc. at the
		// config root; if we wrote the whole serviceConfig we'd nest them
		// under `credentials` and the source would fail to find them.
		passCredentials(cfg, in)
		return
	}

	pkg := requireEnv("PACKAGE")
	sourceID := requireEnv("FROM_ID")
	nangoHost := os.Getenv("NANGO_API_HOST")
	nangoKey := os.Getenv("NANGO_SECRET_KEY")
	if nangoHost == "" || nangoKey == "" {
		logging.Warnf("[oauth] OAuth-authorized sync but NANGO_API_HOST/NANGO_SECRET_KEY not set — using stale tokens from Secret")
		passCredentials(cfg, in)
		return
	}

	integrationID := nangoIntegrationID(pkg)
	if integrationID == "" {
		logging.Warnf("[oauth] no Nango integration mapping for package %q — using stale tokens", pkg)
		passCredentials(cfg, in)
		return
	}

	integration, err := nangoFetchIntegration(nangoHost, nangoKey, integrationID)
	if err != nil {
		logging.Errorf("[oauth] fetching Nango integration %q: %v", integrationID, err)
		os.Exit(1)
	}
	connection, err := nangoFetchConnection(nangoHost, nangoKey, integrationID, sourceID)
	if err != nil {
		logging.Errorf("[oauth] fetching Nango connection sync-source.%s: %v", sourceID, err)
		os.Exit(1)
	}

	merged, err := mergeOAuthCreds(pkg, cfg, integration, connection)
	if err != nil {
		logging.Errorf("[oauth] merge for %q: %v", pkg, err)
		os.Exit(1)
	}

	out, err := json.Marshal(merged)
	if err != nil {
		logging.Errorf("[oauth] marshal merged config: %v", err)
		os.Exit(1)
	}
	if err := writeSharedConfig(configOutPath, out); err != nil {
		logging.Errorf("[oauth] writing %s: %v", configOutPath, err)
		os.Exit(1)
	}
	logging.Infof("[oauth] refreshed credentials for %s (sync-source.%s)", pkg, sourceID)
}

// writeSharedConfig writes /shared/config.json with world-writable mode so the
// airbyte source container (running as a non-root user, e.g. uid 1000) can
// persist refreshed OAuth tokens back to it mid-run. os.WriteFile's perm is
// ANDed with the umask, so we follow up with an explicit Chmod.
func writeSharedConfig(path string, data []byte) error {
	if err := os.WriteFile(path, data, 0o666); err != nil {
		return err
	}
	return os.Chmod(path, 0o666)
}

func passCredentials(cfg map[string]any, raw []byte) {
	if creds, ok := cfg["credentials"]; ok && creds != nil {
		out, err := json.Marshal(creds)
		if err != nil {
			logging.Errorf("[oauth] marshalling credentials: %v", err)
			os.Exit(1)
		}
		if err := writeSharedConfig(configOutPath, out); err != nil {
			logging.Errorf("[oauth] writing %s: %v", configOutPath, err)
			os.Exit(1)
		}
		return
	}
	logging.Errorf("[oauth] credentials not found in %s", configOutPath)
	os.Exit(1)
}

// nangoIntegrationID mirrors the {packageId → nangoIntegrationId} mapping in
// webapps/console/lib/server/oauth/services.ts. Keep in sync with new
// decorators added there.
func nangoIntegrationID(pkg string) string {
	switch pkg {
	case "airbyte/source-github":
		return "jitsu-cloud-sync-github"
	case "airbyte/source-salesforce", "airbyte/source-salesforce-singer":
		return "jitsu-cloud-sync-salesforce"
	case "airbyte/source-google-analytics-v4", "airbyte/source-google-analytics-data-api":
		return "jitsu-cloud-sync-google-analytics"
	case "airbyte/source-google-ads":
		return "jitsu-cloud-sync-google-ads"
	case "airbyte/source-google-sheets":
		return "jitsu-cloud-sync-google-sheets"
	case "airbyte/source-facebook-marketing":
		return "jitsu-cloud-sync-facebook"
	}
	return ""
}

type nangoIntegration struct {
	Config struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	} `json:"config"`
}

type nangoConnection struct {
	Credentials struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	} `json:"credentials"`
}

func nangoGet(host, key, path string, out any) error {
	url := host + path
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("nango %d %s: %s", resp.StatusCode, url, string(body))
	}
	return json.Unmarshal(body, out)
}

func nangoFetchIntegration(host, key, integrationID string) (*nangoIntegration, error) {
	out := &nangoIntegration{}
	err := nangoGet(host, key, fmt.Sprintf("/config/%s?include_creds=true", integrationID), out)
	return out, err
}

// nangoFetchConnection issues the connection lookup with refresh_token=true,
// which causes Nango to refresh the OAuth token if it's near expiry — this
// is the whole reason this init exists.
func nangoFetchConnection(host, key, integrationID, sourceID string) (*nangoConnection, error) {
	out := &nangoConnection{}
	err := nangoGet(host, key,
		fmt.Sprintf("/connection/sync-source.%s?provider_config_key=%s&refresh_token=true", sourceID, integrationID),
		out)
	return out, err
}

// manageStr returns provided iff original is the JITSU_MANAGED placeholder.
// This mirrors the TS manage() helper in services.ts and lets the user pin
// a literal value (e.g. their own access_token) by editing the stored config.
func manageStr(original any, provided string) string {
	if s, ok := original.(string); ok && s != jitsuManaged {
		return s
	}
	return provided
}

// mergeOAuthCreds is the per-package fan-out, mirroring the merge() function
// on each OauthDecorator in webapps/console/lib/server/oauth/services.ts.
// Returns a copy of cfg with refreshed credentials substituted in place.
func mergeOAuthCreds(pkg string, cfg map[string]any, integ *nangoIntegration, conn *nangoConnection) (map[string]any, error) {
	credentials, ok := cfg["credentials"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("no credentials found in %+v", cfg)
	}
	out := deepCopyMap(credentials)
	switch pkg {
	case "airbyte/source-github":
		creds, _ := out["credentials"].(map[string]any)
		if creds == nil {
			return out, nil
		}
		if title, _ := creds["option_title"].(string); title == "OAuth Credentials" {
			creds["access_token"] = manageStr(creds["access_token"], conn.Credentials.AccessToken)
			creds["client_id"] = manageStr(creds["client_id"], integ.Config.ClientID)
			creds["client_secret"] = manageStr(creds["client_secret"], integ.Config.ClientSecret)
		}

	case "airbyte/source-salesforce", "airbyte/source-salesforce-singer":
		// Salesforce decorator merges at the top level of credentials, not
		// inside a nested object.
		out["refresh_token"] = manageStr(out["refresh_token"], conn.Credentials.RefreshToken)
		out["client_id"] = manageStr(out["client_id"], integ.Config.ClientID)
		out["client_secret"] = manageStr(out["client_secret"], integ.Config.ClientSecret)

	case "airbyte/source-google-analytics-v4",
		"airbyte/source-google-analytics-data-api",
		"airbyte/source-google-sheets":
		creds, _ := out["credentials"].(map[string]any)
		if creds == nil {
			return out, nil
		}
		if at, _ := creds["auth_type"].(string); at == "Client" {
			creds["access_token"] = manageStr(creds["access_token"], conn.Credentials.AccessToken)
			creds["refresh_token"] = manageStr(creds["refresh_token"], conn.Credentials.RefreshToken)
			creds["client_id"] = manageStr(creds["client_id"], integ.Config.ClientID)
			creds["client_secret"] = manageStr(creds["client_secret"], integ.Config.ClientSecret)
		}

	case "airbyte/source-google-ads":
		creds, _ := out["credentials"].(map[string]any)
		if creds == nil {
			return out, nil
		}
		devToken := os.Getenv("GOOGLE_ADS_DEVELOPER_TOKEN")
		if devToken == "" {
			return nil, fmt.Errorf("GOOGLE_ADS_DEVELOPER_TOKEN env required for %s", pkg)
		}
		creds["developer_token"] = manageStr(creds["developer_token"], devToken)
		creds["access_token"] = manageStr(creds["access_token"], conn.Credentials.AccessToken)
		creds["refresh_token"] = manageStr(creds["refresh_token"], conn.Credentials.RefreshToken)
		creds["client_id"] = manageStr(creds["client_id"], integ.Config.ClientID)
		creds["client_secret"] = manageStr(creds["client_secret"], integ.Config.ClientSecret)

	case "airbyte/source-facebook-marketing":
		out["access_token"] = manageStr(out["access_token"], conn.Credentials.AccessToken)
		out["client_id"] = manageStr(out["client_id"], integ.Config.ClientID)
		out["client_secret"] = manageStr(out["client_secret"], integ.Config.ClientSecret)

	default:
		// Should be unreachable — nangoIntegrationID() returned non-empty,
		// so the package must be in the switch above. Surface as error so
		// the mapping doesn't silently drift.
		return nil, fmt.Errorf("no merge logic for package %q (mapping/decorator out of sync)", pkg)
	}

	return out, nil
}

// deepCopyMap is a JSON round-trip clone — sufficient because all our config
// blobs are JSON to begin with. Used so mergeOAuthCreds doesn't mutate the
// caller's cfg map.
func deepCopyMap(m map[string]any) map[string]any {
	b, err := json.Marshal(m)
	if err != nil {
		return m
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return m
	}
	return out
}
