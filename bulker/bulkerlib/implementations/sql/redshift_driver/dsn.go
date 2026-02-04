package driver

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/redshiftdata"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

const (
	roleSessionName = "jitsu-aws-redshift-access"
)

type RedshiftConfig struct {
	Host       string            `mapstructure:"host,omitempty" json:"host,omitempty" yaml:"host,omitempty"`
	Port       int               `mapstructure:"port,omitempty" json:"port,omitempty" yaml:"port,omitempty"`
	Db         string            `mapstructure:"database,omitempty" json:"database,omitempty" yaml:"database,omitempty"`
	Schema     string            `mapstructure:"defaultSchema,omitempty" json:"defaultSchema,omitempty" yaml:"defaultSchema,omitempty"`
	Username   string            `mapstructure:"username,omitempty" json:"username,omitempty" yaml:"username,omitempty"`
	Password   string            `mapstructure:"password,omitempty" json:"password,omitempty" yaml:"password,omitempty"`
	Parameters map[string]string `mapstructure:"parameters,omitempty" json:"parameters,omitempty" yaml:"parameters,omitempty"`

	Serverless           bool   `mapstructure:"serverless,omitempty" json:"serverless,omitempty" yaml:"serverless,omitempty"`
	AuthenticationMethod string `mapstructure:"authenticationMethod,omitempty" json:"authenticationMethod,omitempty" yaml:"authenticationMethod,omitempty"`

	ClusterIdentifier   string        `mapstructure:"clusterIdentifier" json:"clusterIdentifier" yaml:"clusterIdentifier"`
	WorkgroupName       string        `mapstructure:"workgroupName" json:"workgroupName" yaml:"workgroupName"`
	SecretsARN          string        `json:"secretsARN"`
	SharedConfigProfile string        `json:"sharedConfigProfile"`
	SessionToken        string        `json:"sessionToken"`
	RoleARN             string        `mapstructure:"roleARN" json:"roleARN" yaml:"roleARN"`
	RoleARNExpiry       time.Duration `json:"roleARNExpiry"` // default: 15m
	ExternalID          string        `mapstructure:"externalID" json:"externalID" yaml:"externalID"`
	Timeout             time.Duration `json:"timeout"`          // default: no timeout
	MinPolling          time.Duration `json:"polling"`          // default: 10ms
	MaxPolling          time.Duration `json:"maxPolling"`       // default: 5s
	RetryMaxAttempts    int           `json:"retryMaxAttempts"` // default: 20

	// S3Config
	AccessKeyID     string `mapstructure:"accessKeyId,omitempty" json:"accessKeyId,omitempty" yaml:"accessKeyId,omitempty"`
	SecretAccessKey string `mapstructure:"secretAccessKey,omitempty" json:"secretAccessKey,omitempty" yaml:"secretAccessKey,omitempty"`
	Bucket          string `mapstructure:"bucket,omitempty" json:"bucket,omitempty" yaml:"bucket,omitempty"`
	Region          string `mapstructure:"region,omitempty" json:"region,omitempty" yaml:"region,omitempty"`
	Folder          string `mapstructure:"folder,omitempty" json:"folder,omitempty" yaml:"folder,omitempty"`

	Params url.Values
}

func (cfg *RedshiftConfig) Sanitize() {
	if cfg.AuthenticationMethod == "iam" {
		cfg.AccessKeyID = ""
		cfg.SecretAccessKey = ""
		cfg.Host = ""
		if cfg.Serverless {
			cfg.ClusterIdentifier = ""
			cfg.Username = ""
			cfg.Password = ""
		} else {
			cfg.WorkgroupName = ""
			cfg.Password = ""
		}
	}
}

func (cfg *RedshiftConfig) Validate() error {
	if cfg.Db == "" {
		return errors.New("database is required")
	}
	if cfg.Schema == "" {
		return errors.New("defaultSchema is required")
	}
	if cfg.Region == "" {
		return errors.New("region is required")
	}
	if cfg.Bucket == "" {
		return errors.New("bucket is required")
	}
	if cfg.AuthenticationMethod == "" || cfg.AuthenticationMethod == "password" {
		if cfg.Host == "" {
			return errors.New("host is required")
		}
		if cfg.Username == "" {
			return errors.New("username is required")
		}
		if cfg.Password == "" {
			return errors.New("password is required")
		}
		if cfg.AccessKeyID == "" {
			return errors.New("accessKeyId is required")
		}
		if cfg.SecretAccessKey == "" {
			return errors.New("secretAccessKey is required")
		}
	} else if cfg.AuthenticationMethod == "iam" {
		if cfg.Serverless {
			if cfg.WorkgroupName == "" {
				return errors.New("workgroupName is required")
			}
		} else {
			if cfg.ClusterIdentifier == "" {
				return errors.New("clusterIdentifier is required")
			}
			if cfg.Username == "" {
				return errors.New("username is required")
			}
		}
		if cfg.RoleARN == "" {
			return errors.New("roleARN is required")
		}
		if cfg.ExternalID == "" {
			return errors.New("externalID is required")
		}
	}
	return nil
}

func (cfg *RedshiftConfig) LoadOpts(ctx context.Context) ([]func(*config.LoadOptions) error, error) {
	var opts []func(*config.LoadOptions) error
	if cfg.Region != "" {
		opts = append(opts, config.WithRegion(cfg.Region))
	}
	if cfg.SharedConfigProfile != "" {
		opts = append(opts, config.WithSharedConfigProfile(cfg.SharedConfigProfile))
	}
	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		opts = append(opts, config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID,
			cfg.SecretAccessKey,
			cfg.SessionToken,
		)))
	}
	if cfg.RoleARN != "" {
		stsCfg, err := config.LoadDefaultConfig(ctx, opts...)
		if err != nil {
			return nil, fmt.Errorf("load default aws config: %w", err)
		}
		stsSvc := sts.NewFromConfig(stsCfg)
		opts = append([]func(*config.LoadOptions) error{}, config.WithCredentialsProvider(stscreds.NewAssumeRoleProvider(stsSvc, cfg.RoleARN, func(o *stscreds.AssumeRoleOptions) {
			if cfg.ExternalID != "" {
				o.ExternalID = aws.String(cfg.ExternalID)
			}
			o.RoleSessionName = roleSessionName
			o.Duration = cfg.RoleARNExpiry
		})), config.WithCredentialsCacheOptions(func(o *aws.CredentialsCacheOptions) {
			o.ExpiryWindow = 2 * time.Minute
		}))
	}
	opts = append(opts, config.WithRetryMaxAttempts(cfg.GetRetryMaxAttempts()))
	return opts, nil
}

func (cfg *RedshiftConfig) Opts() []func(*redshiftdata.Options) {
	var opts []func(*redshiftdata.Options)
	if cfg.Region != "" {
		opts = append(opts, func(o *redshiftdata.Options) {
			o.Region = cfg.Region
		})
	}
	return opts
}

func (cfg *RedshiftConfig) String() string {
	base := strings.TrimPrefix(cfg.baseString(), "//")
	if base == "" {
		return ""
	}
	params := url.Values{}
	for key, value := range cfg.Params {
		params[key] = append([]string{}, value...)
	}
	if cfg.Timeout != 0 {
		params.Add("timeout", cfg.Timeout.String())
	} else {
		params.Del("timeout")
	}
	if cfg.MinPolling != 0 {
		params.Add("minPolling", cfg.MinPolling.String())
	} else {
		params.Del("minPolling")
	}
	if cfg.MaxPolling != 0 {
		params.Add("maxPolling", cfg.MaxPolling.String())
	} else {
		params.Del("maxPolling")
	}
	if cfg.RetryMaxAttempts > 0 {
		params.Add("retryMaxAttempts", strconv.Itoa(cfg.RetryMaxAttempts))
	} else {
		params.Del("retryMaxAttempts")
	}
	if cfg.Region != "" {
		params.Add("region", cfg.Region)
	} else {
		params.Del("region")
	}
	if cfg.SharedConfigProfile != "" {
		params.Add("sharedConfigProfile", cfg.SharedConfigProfile)
	} else {
		params.Del("sharedConfigProfile")
	}
	if cfg.AccessKeyID != "" {
		params.Add("accessKeyId", cfg.AccessKeyID)
	} else {
		params.Del("accessKeyId")
	}
	if cfg.SecretAccessKey != "" {
		params.Add("secretAccessKey", cfg.SecretAccessKey)
	} else {
		params.Del("secretAccessKey")
	}
	if cfg.SessionToken != "" {
		params.Add("sessionToken", cfg.SessionToken)
	} else {
		params.Del("sessionToken")
	}
	if cfg.RoleARN != "" {
		params.Add("roleARN", cfg.RoleARN)
	} else {
		params.Del("roleARN")
	}
	if cfg.ExternalID != "" {
		params.Add("externalID", cfg.ExternalID)
	} else {
		params.Del("externalID")
	}
	if cfg.RoleARNExpiry > 0 {
		params.Add("roleARNExpiry", cfg.RoleARNExpiry.String())
	} else {
		params.Del("roleARNExpiry")
	}
	encodedParams := params.Encode()
	if encodedParams != "" {
		return base + "?" + encodedParams
	}
	return base
}

func (cfg *RedshiftConfig) setParams(params url.Values) error {
	var err error
	cfg.Params = params
	if params.Has("timeout") {
		cfg.Timeout, err = time.ParseDuration(params.Get("timeout"))
		if err != nil {
			return fmt.Errorf("parse timeout as duration: %w", err)
		}
		cfg.Params.Del("timeout")
	}
	if params.Has("minPolling") {
		cfg.MinPolling, err = time.ParseDuration(params.Get("minPolling"))
		if err != nil {
			return fmt.Errorf("parse min polling as duration: %w", err)
		}
		cfg.Params.Del("minPolling")
	}
	if params.Has("maxPolling") {
		cfg.MaxPolling, err = time.ParseDuration(params.Get("maxPolling"))
		if err != nil {
			return fmt.Errorf("parse max polling as duration: %w", err)
		}
		cfg.Params.Del("maxPolling")
	}
	if params.Has("retryMaxAttempts") {
		cfg.RetryMaxAttempts, err = strconv.Atoi(params.Get("retryMaxAttempts"))
		if err != nil {
			return fmt.Errorf("parse retry max attempts as int: %w", err)
		}
		cfg.Params.Del("retryMaxAttempts")
	}
	if params.Has("region") {
		cfg.Region = params.Get("region")
		cfg.Params.Del("region")
	}
	if params.Has("sharedConfigProfile") {
		cfg.SharedConfigProfile = params.Get("sharedConfigProfile")
		cfg.Params.Del("sharedConfigProfile")
	}
	if params.Has("accessKeyId") {
		cfg.AccessKeyID = params.Get("accessKeyId")
		cfg.Params.Del("accessKeyId")
	}
	if params.Has("secretAccessKey") {
		cfg.SecretAccessKey = params.Get("secretAccessKey")
		cfg.Params.Del("secretAccessKey")
	}
	if params.Has("sessionToken") {
		cfg.SessionToken = params.Get("sessionToken")
		cfg.Params.Del("sessionToken")
	}
	if params.Has("roleARN") {
		cfg.RoleARN = params.Get("roleARN")
		cfg.Params.Del("roleARN")
	}
	if params.Has("externalID") {
		cfg.ExternalID = params.Get("externalID")
		cfg.Params.Del("externalID")
	}
	if params.Has("roleARNExpiry") {
		cfg.RoleARNExpiry, err = time.ParseDuration(params.Get("roleARNExpiry"))
		if err != nil {
			return fmt.Errorf("parse role arn expiry as duration: %w", err)
		}
		cfg.Params.Del("roleARNExpiry")
	}
	if len(cfg.Params) == 0 {
		cfg.Params = nil
	}
	return nil
}

func (cfg *RedshiftConfig) baseString() string {
	if cfg.SecretsARN != "" {
		return cfg.SecretsARN
	}
	var u url.URL
	if cfg.ClusterIdentifier != "" && cfg.Username != "" {
		u.Host = fmt.Sprintf("cluster(%s)", cfg.ClusterIdentifier)
		u.User = url.User(cfg.Username)
	}
	if cfg.WorkgroupName != "" {
		u.Host = fmt.Sprintf("workgroup(%s)", cfg.WorkgroupName)
	}
	if u.Host == "" || cfg.Db == "" {
		return ""
	}
	u.Path = cfg.Db
	return u.String()
}

func (cfg *RedshiftConfig) GetMinPolling() time.Duration {
	if cfg.MinPolling == 0 {
		return 10 * time.Millisecond
	}
	return cfg.MinPolling
}

func (cfg *RedshiftConfig) GetMaxPolling() time.Duration {
	if cfg.MaxPolling == 0 {
		return 5 * time.Second
	}
	return cfg.MaxPolling
}

func (cfg *RedshiftConfig) GetRetryMaxAttempts() int {
	if cfg.RetryMaxAttempts <= 0 {
		return 20
	}
	return cfg.RetryMaxAttempts
}

func ParseDSN(dsn string) (*RedshiftConfig, error) {
	if dsn == "" {
		return nil, ErrDSNEmpty
	}
	if strings.HasPrefix(dsn, "arn:") {
		parts := strings.Split(dsn, "?")
		cfg := &RedshiftConfig{
			SecretsARN: parts[0],
		}
		if len(parts) >= 2 {
			params, err := url.ParseQuery(strings.Join(parts[1:], "?"))
			if err != nil {
				return nil, fmt.Errorf("dsn is invalid: can not parse query params: %w", err)
			}
			if err := cfg.setParams(params); err != nil {
				return nil, fmt.Errorf("dsn is invalid: set query params: %w", err)
			}
		}
		return cfg, nil
	}
	u, err := url.Parse("redshift-data://" + dsn)
	if err != nil {
		return nil, fmt.Errorf("dsn is invalid: %w", err)
	}
	cfg := &RedshiftConfig{
		Db: strings.TrimPrefix(u.Path, "/"),
	}
	if cfg.Db == "" {
		return nil, errors.New("dsn is invalid: missing database")
	}
	if err := cfg.setParams(u.Query()); err != nil {
		return nil, fmt.Errorf("dsn is invalid: set query params: %w", err)
	}
	if strings.HasPrefix(u.Host, "cluster(") {
		cfg.Username = u.User.Username()
		cfg.ClusterIdentifier = strings.TrimSuffix(strings.TrimPrefix(u.Host, "cluster("), ")")
		return cfg, nil
	}
	if strings.HasPrefix(u.Host, "workgroup(") {
		cfg.WorkgroupName = strings.TrimSuffix(strings.TrimPrefix(u.Host, "workgroup("), ")")
		return cfg, nil
	}
	return nil, errors.New("dsn is invalid: workgroup(name)/database or username@cluster(name)/database or secrets_arn")
}
