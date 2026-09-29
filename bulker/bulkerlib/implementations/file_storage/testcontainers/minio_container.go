package testcontainers

import (
	"archive/tar"
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
)

//go:embed Dockerfile.minio
var minioDockerfile []byte

const (
	minioAccessKey = "test_minio_access_key"
	minioSecretKey = "test_minio_secret_key"
)

// MinioContainer is a Min.IO testcontainer
type MinioContainer struct {
	Container testcontainers.Container
	Context   context.Context
	Host      string
	Port      int
	AccessKey string
	SecretKey string
}

// NewMinioContainer creates new MySQL test container if MYSQL_TEST_PORT is not defined. Otherwise uses db at defined port.
// This logic is required for running test at CI environment
func NewMinioContainer(ctx context.Context, bucketName string) (*MinioContainer, error) {
	dbSettings := make(map[string]string, 0)
	dbSettings["MINIO_ACCESS_KEY"] = minioAccessKey
	dbSettings["MINIO_SECRET_KEY"] = minioSecretKey

	hostPort := fmt.Sprintf("%d", utils.GetPort())

	// Embed the build context so tests also work from a compiled test binary.
	// Docker caches the source build locally; no private image registry is needed.
	var buildContext bytes.Buffer
	tw := tar.NewWriter(&buildContext)
	if err := tw.WriteHeader(&tar.Header{Name: "Dockerfile", Mode: 0644, Size: int64(len(minioDockerfile))}); err != nil {
		return nil, err
	}
	if _, err := tw.Write(minioDockerfile); err != nil {
		return nil, err
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			FromDockerfile: testcontainers.FromDockerfile{
				ContextArchive: bytes.NewReader(buildContext.Bytes()),
				KeepImage:      true,
				BuildLogWriter: os.Stdout,
			},
			Cmd:          []string{"server", "/data"},
			ExposedPorts: []string{"9000/tcp"},
			HostConfigModifier: func(hc *container.HostConfig) {
				hc.PortBindings = network.PortMap{
					network.MustParsePort("9000/tcp"): []network.PortBinding{{HostPort: hostPort}},
				}
			},
			Env:        dbSettings,
			WaitingFor: tcWait.ForListeningPort("9000/tcp"),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	port, err := container.MappedPort(ctx, "9000")
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}
	mc := MinioContainer{
		Container: container,
		Context:   ctx,
		Host:      host,
		Port:      int(port.Num()),
		AccessKey: minioAccessKey,
		SecretKey: minioSecretKey,
	}
	err = mc.createBucket(bucketName)
	if err != nil {
		_ = mc.Close()
		return nil, err
	}
	return &mc, nil
}

func (mc *MinioContainer) createBucket(bucketName string) error {
	var opts []func(*config.LoadOptions) error
	opts = append(opts, config.WithRegion("us-east-1"))
	opts = append(opts, config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
		minioAccessKey,
		minioSecretKey,
		"",
	)))
	awsCfg, err := config.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("http://%s:%d", mc.Host, mc.Port)
	o := func(o *s3.Options) {
		o.BaseEndpoint = &endpoint
		o.UsePathStyle = true
	}
	client := s3.NewFromConfig(awsCfg, o)
	_, err = client.CreateBucket(context.Background(), &s3.CreateBucketInput{
		Bucket: &bucketName,
	})
	if err != nil {
		return err
	}
	return nil

}

// Close terminates underlying mysql docker container
func (mc *MinioContainer) Close() error {
	if mc.Container != nil {
		err := mc.Container.Terminate(mc.Context)
		if err != nil {
			logging.Errorf("Failed to stop MySQL container: %v", err)
		}
	}

	return nil
}

func (mc *MinioContainer) Stop() error {
	return mc.Container.Stop(context.Background(), nil)
}

func (mc *MinioContainer) Start() error {
	return mc.Container.Start(context.Background())
}
