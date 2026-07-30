package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/pg"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"io"
	"os"
	"path"
	"sync/atomic"
	"time"
)

const SQLLastUpdatedQuery = `select * from last_updated`

type PostgresConfigurationSource struct {
	appbase.Service
	dbpool           *pgxpool.Pool
	changesChan      chan bool
	refreshPeriodSec int
	inited           atomic.Bool
	cacheDir         string
	sqlQuery         string
	connections      atomic.Pointer[map[string]*DestinationConfig]
	lastModified     atomic.Pointer[time.Time]
	closed           chan struct{}
}

type RepositoryCache struct {
	Connections map[string]*DestinationConfig `json:"destinations"`
}

func NewPostgresConfigurationSource(appconfig *Config) (*PostgresConfigurationSource, error) {
	base := appbase.NewServiceBase("repository")
	dbpool, err := pg.NewPGPool(appconfig.ConfigSource)
	if err != nil {
		return nil, base.NewError("Unable to create postgres connection pool: %v\n", err)
	}
	r := &PostgresConfigurationSource{
		Service:          base,
		dbpool:           dbpool,
		refreshPeriodSec: appconfig.ConfigRefreshPeriodSec,
		changesChan:      make(chan bool, 1),
		cacheDir:         appconfig.CacheDir,
		sqlQuery:         appconfig.ConfigSourceSQLQuery,
		closed:           make(chan struct{}),
	}
	r.refresh(false)
	r.start()
	return r, nil
}

func (r *PostgresConfigurationSource) loadCached() {
	file, err := os.Open(path.Join(r.cacheDir, "repository.json"))
	if err != nil {
		r.Fatalf("Error opening cached repository: %v\nCannot serve without repository. Exitting...", err)
		return
	}
	defer func() {
		_ = file.Close()
	}()
	stat, err := file.Stat()
	if err != nil {
		r.Fatalf("Error getting cached repository info: %v\nCannot serve without repository. Exitting...", err)
		return
	}
	fileSize := stat.Size()
	if fileSize == 0 {
		r.Fatalf("Cached repository is empty\nCannot serve without repository. Exitting...")
		return
	}
	payload, err := io.ReadAll(file)
	if err != nil {
		r.Fatalf("Error reading cached script: %v\nCannot serve without repository. Exitting...", err)
		return
	}
	repositoryCache := RepositoryCache{}
	err = jsoniter.Unmarshal(payload, &repositoryCache)
	if err != nil {
		r.Fatalf("Error unmarshalling cached repository: %v\nCannot serve without repository. Exitting...", err)
		return
	}
	r.connections.Store(&repositoryCache.Connections)
	r.inited.Store(true)
	r.Infof("Loaded cached repository data: %d bytes, last modified: %v", fileSize, stat.ModTime())
}

func (r *PostgresConfigurationSource) storeCached(payload RepositoryCache) {
	filePath := path.Join(r.cacheDir, "repository.json")
	err := os.MkdirAll(r.cacheDir, 0755)
	if err != nil {
		r.Errorf("Cannot write cached repository to %s: cannot make dir: %v", filePath, err)
		return
	}
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		r.Errorf("Cannot write cached repository to %s: %v", filePath, err)
		return
	}
	defer func() {
		_ = file.Close()
	}()
	err = json.NewEncoder(file).Encode(payload)
	if err != nil {
		r.Errorf("Cannot write cached repository to %s: %v", filePath, err)
		return
	}
	err = file.Sync()
	if err != nil {
		r.Errorf("Cannot write cached script to %s: %v", filePath, err)
		return
	}
}

func (r *PostgresConfigurationSource) refresh(notify bool) {
	start := time.Now()
	connections := map[string]*DestinationConfig{}
	var err error
	defer func() {
		if err != nil {
			r.Errorf("Error refreshing repository: %v", err)
			metrics.ConfigurationSourceError("error").Inc()
			if !r.inited.Load() {
				if r.cacheDir != "" {
					r.loadCached()
				} else {
					r.Fatalf("Cannot load cached repository. No CACHE_DIR is set. Cannot serve without repository. Exitting...")
				}
			}
		} else {
			r.Debugf("Refreshed in %v", time.Now().Sub(start))
		}
	}()
	ifModifiedSince := r.lastModified.Load()
	var lastModified time.Time
	err = r.dbpool.QueryRow(context.Background(), SQLLastUpdatedQuery).Scan(&lastModified)
	if err != nil {
		err = r.NewError("Error querying last updated: %v", err)
		return
	} else if errors.Is(err, pgx.ErrNoRows) || lastModified.IsZero() {
		//Failed to load repository last updated date. Probably database has no records yet.
		r.connections.Store(&connections)
		r.inited.Store(true)
		return
	}
	if ifModifiedSince != nil && lastModified.Compare(*ifModifiedSince) <= 0 {
		return
	}
	r.Infof("Config updated: %s previous update date: %s`", lastModified, ifModifiedSince)

	rows, err := r.dbpool.Query(context.Background(), r.sqlQuery)
	if err != nil {
		err = r.NewError("Error querying connections: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var connectionId string
		var connectionConfig string
		var tp string
		err = rows.Scan(&connectionId, &tp, &connectionConfig)
		if err != nil {
			err = r.NewError("Error scanning row: %v", err)
			return
		}
		//r.Infof("Stream %s: %s", streamId, streamConfig)
		c := DestinationConfig{}
		err = jsoniter.UnmarshalFromString(connectionConfig, &c)
		if err != nil {
			metrics.ConfigurationSourceError("parse_error").Inc()
			r.Errorf("failed to parse config for destination %s: %s: %v", connectionId, connectionConfig, err)
		}
		if c.UsesBulker || tp == "sync" {
			connections[connectionId] = &c
		}
	}
	r.connections.Store(&connections)
	r.inited.Store(true)
	r.lastModified.Store(&lastModified)
	if r.cacheDir != "" {
		r.storeCached(RepositoryCache{Connections: connections})
	}
	if notify {
		select {
		case r.changesChan <- true:
			//notify listener if it is listening
		default:
		}
	}
}

func (r *PostgresConfigurationSource) start() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Duration(r.refreshPeriodSec) * time.Second)
		for {
			select {
			case <-ticker.C:
				r.refresh(true)
			case <-r.closed:
				ticker.Stop()
				return
			}
		}
	})
}

func (r *PostgresConfigurationSource) Close() error {
	close(r.closed)
	close(r.changesChan)
	r.dbpool.Close()
	return nil
}

func (r *PostgresConfigurationSource) ChangesChannel() <-chan bool {
	return r.changesChan
}

func (r *PostgresConfigurationSource) GetDestinationConfigs() []*DestinationConfig {
	connections := *r.connections.Load()
	results := make([]*DestinationConfig, 0, len(connections))
	for _, connection := range connections {
		results = append(results, connection)
	}
	return results
}

func (r *PostgresConfigurationSource) GetDestinationConfig(id string) *DestinationConfig {
	connections := *r.connections.Load()
	return connections[id]
}
