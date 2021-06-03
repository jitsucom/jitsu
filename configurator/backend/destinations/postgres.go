package destinations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/random"
	"github.com/jitsucom/jitsu/server/logging"
	_ "github.com/lib/pq"
	"github.com/spf13/viper"
	"strings"
)

type DatasourceConfig struct {
	Host        string
	ReplicaHost string
	Db          string
	Port        int
	Username    string
	Password    string
}

func (dc *DatasourceConfig) ConnectionString() string {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s ",
		dc.Host, dc.Port, dc.Db, dc.Username, dc.Password)
	return connectionString
}

type Postgres struct {
	ctx        context.Context
	config     *DatasourceConfig
	dataSource *sql.DB
}

func NewPostgres(ctx context.Context, postgresDestinationViper *viper.Viper) (*Postgres, error) {
	host := postgresDestinationViper.GetString("host")
	replicaHost := postgresDestinationViper.GetString("replica_host")
	if replicaHost == "" {
		replicaHost = host
	}
	port := postgresDestinationViper.GetInt("port")
	username := postgresDestinationViper.GetString("username")
	password := postgresDestinationViper.GetString("password")
	db := postgresDestinationViper.GetString("database")
	if host == "" || username == "" || password == "" || db == "" {
		return nil, errors.New("host, database, username and password are required to configure postgres destination")
	}
	dsConfig := &DatasourceConfig{Host: host, ReplicaHost: replicaHost, Port: port, Username: username, Password: password, Db: db}

	dataSource, err := sql.Open("postgres", dsConfig.ConnectionString())
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &Postgres{
		ctx:        ctx,
		config:     dsConfig,
		dataSource: dataSource,
	}, nil
}

func (p *Postgres) CreateDatabase(projectID string) (*entities.Database, error) {
	db := "db_" + strings.ToLower(projectID)
	logging.Infof("db " + db)
	_, err := p.dataSource.Exec("CREATE DATABASE " + db)
	if err != nil {
		return nil, err
	}

	_, err = p.dataSource.Exec("REVOKE ALL on database " + db + " FROM public;")
	if err != nil {
		return nil, err
	}

	tx, err := p.dataSource.BeginTx(p.ctx, nil)
	if err != nil {
		return nil, err
	}

	username := "u_" + strings.ToLower(projectID)
	logging.Infof("Generated username: " + username)
	password := random.String(16)
	logging.Info("Generated password: " + password)

	var queries []string
	queries = append(queries, fmt.Sprintf("CREATE USER %s WITH PASSWORD '%s';", username, password))
	queries = append(queries, fmt.Sprintf("GRANT CONNECT ON DATABASE %s TO %s;", db, username))
	queries = append(queries, fmt.Sprintf("GRANT CREATE ON DATABASE %s TO %s;", db, username))
	queries = append(queries, fmt.Sprintf("ALTER DEFAULT PRIVILEGES FOR USER %s GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %s;", username, username))

	err = executeQueriesInTx(queries, tx)
	if err != nil {
		return nil, err
	}
	commitErr := tx.Commit()
	if commitErr != nil {
		return nil, commitErr
	}

	generatedCredentials := entities.Database{Host: p.config.Host, Port: p.config.Port, Database: db, User: username, Password: password}
	return &generatedCredentials, nil
}

func (p *Postgres) Close() error {
	if err := p.dataSource.Close(); err != nil {
		return fmt.Errorf("Error closing postgres connection: %v", err)
	}

	return nil
}

func executeQueriesInTx(queries []string, transaction *sql.Tx) error {
	for i := range queries {
		_, err := transaction.Exec(queries[i])
		if err != nil {
			if rollbackErr := transaction.Rollback(); rollbackErr != nil {
				logging.Errorf("System error: unable to rollback transaction: %v", rollbackErr)
			}
			return err
		}
	}
	return nil
}
