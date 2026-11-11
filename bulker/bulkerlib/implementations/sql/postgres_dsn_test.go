package sql

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/require"
)

func parsePg(t *testing.T, settings []pgSetting, params map[string]string) *pgx.ConnConfig {
	t.Helper()
	cs, err := pgConnectionString(settings, params)
	require.NoError(t, err)
	cfg, err := pgx.ParseConfig(cs)
	require.NoError(t, err, cs)
	return cfg
}

func baseSettings() []pgSetting {
	return []pgSetting{
		{"host", "db.customer.com"}, {"port", "5432"}, {"dbname", "events"},
		{"user", "jitsu"}, {"password", "real"}, {"search_path", "public"},
	}
}

func TestPgConnectionStringPlainValues(t *testing.T) {
	cfg := parsePg(t, baseSettings(), map[string]string{"connect_timeout": "90", "sslmode": "require"})
	require.Equal(t, "db.customer.com", cfg.Host)
	require.Equal(t, uint16(5432), cfg.Port)
	require.Equal(t, "events", cfg.Database)
	require.Equal(t, "jitsu", cfg.User)
	require.Equal(t, "real", cfg.Password)
	require.Equal(t, "public", cfg.RuntimeParams["search_path"])
}

// The attack of JITSU-257/JITSU-270: a space in a name field used to start a new setting, and the last host won.
func TestPgConnectionStringValueCannotAddASetting(t *testing.T) {
	for _, field := range []string{"dbname", "user", "search_path"} {
		for _, value := range []string{
			"x host=attacker.example",
			"x\thost=attacker.example",
			"x\nhost=attacker.example",
			"x' host='attacker.example",
			`x\' host=attacker.example`,
			`x\`,
			`'`,
			"x password=stolen",
		} {
			settings := baseSettings()
			for i := range settings {
				if settings[i].Name == field {
					settings[i].Value = value
				}
			}
			cfg := parsePg(t, settings, nil)
			require.Equal(t, "db.customer.com", cfg.Host, "%s=%q", field, value)
			require.Equal(t, "real", cfg.Password, "%s=%q", field, value)
			switch field {
			case "dbname":
				require.Equal(t, value, cfg.Database)
			case "user":
				require.Equal(t, value, cfg.User)
			case "search_path":
				require.Equal(t, value, cfg.RuntimeParams["search_path"])
			}
		}
	}
}

func TestPgConnectionStringPasswordWithSpecialCharacters(t *testing.T) {
	for _, password := range []string{"p a ss", "it's", `back\slash`, "a=b", "'quoted'", "tab\there", "ünïcode"} {
		settings := baseSettings()
		settings[4].Value = password
		require.Equal(t, password, parsePg(t, settings, nil).Password)
	}
}

// Unquoted, `password= search_path=public` made the password `search_path=public` and dropped the schema.
func TestPgConnectionStringEmptyValues(t *testing.T) {
	settings := baseSettings()
	settings[4].Value = ""
	cfg := parsePg(t, settings, nil)
	require.Equal(t, "", cfg.Password)
	require.Equal(t, "public", cfg.RuntimeParams["search_path"])
	require.Equal(t, "events", cfg.Database)
}

func TestPgConnectionStringParameterValuesAreQuoted(t *testing.T) {
	cfg := parsePg(t, baseSettings(), map[string]string{"options": "-c statement_timeout=5000 host=attacker.example"})
	require.Equal(t, "db.customer.com", cfg.Host)
	require.Equal(t, "-c statement_timeout=5000 host=attacker.example", cfg.RuntimeParams["options"])
}

func TestPgConnectionStringRefusesBadParameterNames(t *testing.T) {
	for _, name := range []string{"", "a b", "a=b", "host=attacker.example x", "a'b", "1abc", "a-b", "a..b", ".a", "a.", "a. b", "a.1b", "ext.x=host"} {
		_, err := pgConnectionString(baseSettings(), map[string]string{name: "v"})
		require.Error(t, err, "%q", name)
	}
	_, err := pgConnectionString([]pgSetting{{"dbname", "a\x00b"}}, nil)
	require.Error(t, err)
}

// Server settings of extensions have dotted names and pgx forwards them to the server as runtime parameters.
func TestPgConnectionStringAllowsDottedParameterNames(t *testing.T) {
	cfg := parsePg(t, baseSettings(), map[string]string{"pg_trgm.similarity_threshold": "0.5", "my_ext.nested.name": "x y"})
	require.Equal(t, "0.5", cfg.RuntimeParams["pg_trgm.similarity_threshold"])
	require.Equal(t, "x y", cfg.RuntimeParams["my_ext.nested.name"])
	require.Equal(t, "db.customer.com", cfg.Host)
}

// End to end against the Postgres container: the server confirms the dotted setting, as the previous DSN allowed.
func TestPostgresDottedRuntimeParameterReachesTheServer(t *testing.T) {
	if postgresContainer == nil {
		t.Skip("needs the Postgres test container (BULKER_TEST_CONFIGS=postgres or all)")
	}
	cs, err := pgConnectionString([]pgSetting{
		{"host", postgresContainer.Host}, {"port", fmt.Sprint(postgresContainer.Port)}, {"dbname", postgresContainer.Database},
		{"user", postgresContainer.Username}, {"password", postgresContainer.Password},
	}, map[string]string{"sslmode": "disable", "pg_trgm.similarity_threshold": "0.5"})
	require.NoError(t, err)
	conn, err := pgx.Connect(context.Background(), cs)
	require.NoError(t, err)
	defer conn.Close(context.Background())
	var got string
	require.NoError(t, conn.QueryRow(context.Background(), "SHOW pg_trgm.similarity_threshold").Scan(&got))
	require.Equal(t, "0.5", got)
}

func TestPgConnectionStringIsDeterministic(t *testing.T) {
	params := map[string]string{"b": "2", "a": "1", "c": "3"}
	first, err := pgConnectionString(baseSettings(), params)
	require.NoError(t, err)
	for i := 0; i < 20; i++ {
		again, err := pgConnectionString(baseSettings(), params)
		require.NoError(t, err)
		require.Equal(t, first, again)
	}
}

// End to end, against the Postgres container the other tests use: a database name that carries a second host must be
// taken as a database name. Unquoted, the client dialed attacker.example instead and never reached this server.
func TestPostgresDatabaseNameCannotAddAHost(t *testing.T) {
	if postgresContainer == nil {
		t.Skip("needs the Postgres test container (BULKER_TEST_CONFIGS=postgres or all)")
	}
	dsc := DataSourceConfig{
		Host:       postgresContainer.Host,
		Port:       postgresContainer.Port,
		Username:   postgresContainer.Username,
		Password:   postgresContainer.Password,
		Db:         postgresContainer.Database + " host=attacker.example",
		Schema:     postgresContainer.Schema,
		Parameters: map[string]string{"sslmode": "disable"},
	}
	b, err := NewPostgres(bulker.Config{Id: "dsn-injection", BulkerType: PostgresBulkerTypeId, DestinationConfig: PostgresConfig{DataSourceConfig: dsc}})
	if b != nil {
		_ = b.Close()
	}
	require.Error(t, err)
	// the server answered, so the connection went to the configured host
	require.Contains(t, err.Error(), "does not exist")
	require.NotContains(t, err.Error(), "attacker.example:")
}
