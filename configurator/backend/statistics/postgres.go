package statistics

import (
	"database/sql"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"time"
)

const queryTemplate = `select date_trunc('%s', _timestamp) as key, count(*) as value from statistics.statistics
					 where _timestamp between '%s' AND '%s' AND (%s api_key like 'js.%s.%%' or api_key like 's2s.%s.%%')
					 group by key
					 order by key ASC;`

type Postgres struct {
	//backward compatibility for first api keys
	oldKeysByProject map[string][]string
	db               *sql.DB
}

func NewPostgres(config *adapters.DataSourceConfig, oldKeysByProject map[string][]string) (Storage, error) {
	port := 5432
	if config.Port.String() != "" {
		portInt64, err := config.Port.Int64()
		if err != nil {
			return nil, fmt.Errorf("Error parsing port [%s] into int: %v", config.Port.String(), err)
		}

		port = int(portInt64)
	}
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s ",
		config.Host, port, config.Db, config.Username, config.Password)
	for k, v := range config.Parameters {
		connectionString += k + "=" + v + " "
	}
	db, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(); err != nil {
		return nil, err
	}

	if oldKeysByProject == nil {
		oldKeysByProject = map[string][]string{}
	}

	return &Postgres{db: db, oldKeysByProject: oldKeysByProject}, nil
}

func (p *Postgres) GetEvents(projectId string, from, to time.Time, granularity string) ([]EventsPerTime, error) {
	oldKeysHackPart := ""
	if keys, ok := p.oldKeysByProject[projectId]; ok {
		for i := range keys {
			oldKeysHackPart = oldKeysHackPart + "api_key like '" + keys[i] + "' or "
		}
	}

	query := fmt.Sprintf(queryTemplate, granularity, from.Format(responseTimestampLayout), to.Format(responseTimestampLayout), oldKeysHackPart, projectId, projectId)
	rows, err := p.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	eventsPerTime := make([]EventsPerTime, 0)
	for rows.Next() {
		data := EventsPerTime{}
		var date string
		err := rows.Scan(&date, &data.Events)
		if err != nil {
			return nil, err
		}
		data.Key, err = convertDateToResponseFormat(date)
		if err != nil {
			return nil, err
		}
		eventsPerTime = append(eventsPerTime, data)
	}

	return eventsPerTime, nil
}

func (p *Postgres) Close() error {
	if err := p.db.Close(); err != nil {
		return fmt.Errorf("Error closing statistics postgres datasource: %v", err)
	}

	return nil
}

func convertDateToResponseFormat(dateString string) (string, error) {
	parsed, err := time.Parse(requestTimestampLayout, dateString)
	if err != nil {
		return "", err
	}
	return parsed.Format(responseTimestampLayout), nil
}
