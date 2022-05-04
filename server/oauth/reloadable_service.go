package oauth

import (
	"context"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/carlmjohnson/requests"
	"github.com/gobeam/stringy"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/pkg/errors"
)

type Credentials struct {
	ID      string            `json:"id"`
	Driver  string            `json:"driver"`
	Secrets map[string]string `json:"secrets"`
}

type ReloadableService struct {
	url     string
	token   string
	secrets map[string]Secrets
	mu      sync.RWMutex
	cancel  func()
	work    sync.WaitGroup
}

func NewReloadableService(rawURL string) (*ReloadableService, error) {
	url, err := url.Parse(rawURL)
	if err != nil {
		return nil, errors.Wrapf(err, "parse oauth secrets url %s", rawURL)
	}

	var token string
	if user := url.User; user != nil {
		token, _ = user.Password()
	}

	ctx, cancel := context.WithCancel(context.Background())
	s := &ReloadableService{
		url:     rawURL,
		token:   token,
		secrets: make(map[string]Secrets),
		cancel:  cancel,
	}

	if err := s.refreshSecrets(ctx); err != nil {
		cancel()
		return nil, errors.Wrap(err, "refresh oauth secrets")
	}

	s.work.Add(1)
	safego.Run(func() {
		ticker := time.NewTicker(time.Minute)
		defer func() {
			ticker.Stop()
			cancel()
			s.work.Done()
		}()

		for {
			select {
			case <-ticker.C:
				if err := s.refreshSecrets(ctx); err != nil {
					logging.Errorf("Failed to refresh OAuth secrets: %s", err)
					continue
				}

				logging.Debugf("Refreshed OAuth secrets successfully")

			case <-ctx.Done():
				return
			}
		}
	})

	return s, nil
}

func (s *ReloadableService) refreshSecrets(ctx context.Context) error {
	var resp []Credentials
	if err := requests.URL(s.url).
		Bearer(s.token).
		CheckStatus(http.StatusOK).
		ToJSON(&resp).
		Fetch(ctx); err != nil {
		return err
	}

	newSecrets := make(map[string]Secrets)
	for _, cred := range resp {
		if _, ok := newSecrets[cred.ID]; ok {
			return errors.Errorf("duplicate oauth provider ID %s", cred.ID)
		}

		secret := make(Secrets)
		for key, value := range cred.Secrets {
			secret[stringy.New(key).SnakeCase().ToLower()] = SecretValue{
				Value:    value,
				Provided: true,
			}
		}

		newSecrets[cred.ID] = secret
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.secrets = newSecrets

	return nil
}

func (s *ReloadableService) Get(id string) (Secrets, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	secret, ok := s.secrets[id]
	return secret, ok
}

func (s *ReloadableService) Close() error {
	s.cancel()
	s.work.Wait()
	return nil
}
