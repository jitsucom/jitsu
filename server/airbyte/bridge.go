package airbyte

import (
	"context"
	"fmt"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/client"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"io/ioutil"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	BridgeType                  = "airbyte_bridge"
	DockerImageRepositoryPrefix = "airbyte/"

	VolumeAlias     = "/tmp/airbyte/"
	DockerCommand   = "docker"
	LatestVersion   = "latest"
	MountVolumeType = "volume"

	mountDockerSockMsg = "For using Airbyte run Jitsu docker with: -v /var/run/docker.sock:/var/run/docker.sock"
)

var (
	Instance *Bridge
)

type Bridge struct {
	LogWriter       io.Writer
	ConfigDir       string
	WorkspaceVolume string

	batchSize int
	//spec loading
	imageMutex    *sync.RWMutex
	pullingImages *sync.Map
	pulledImages  map[string]bool
}

//Init initializes airbyte Bridge
func Init(ctx context.Context, containerizedRun bool, configDir, workspaceVolume string, batchSize int, logWriter io.Writer) error {
	logging.Infof("Initializing Airbyte bridge. Batch size: %d", batchSize)

	if logWriter == nil {
		logWriter = ioutil.Discard
	}
	Instance = &Bridge{
		LogWriter:       logWriter,
		ConfigDir:       configDir,
		WorkspaceVolume: workspaceVolume,

		batchSize:     batchSize,
		imageMutex:    &sync.RWMutex{},
		pullingImages: &sync.Map{},
		pulledImages:  map[string]bool{},
	}

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("error creating docker client: %v. %s", err, mountDockerSockMsg)
	}
	defer cli.Close()

	logging.Infof("[airbyte] Loading local airbyte docker images..")
	images, err := cli.ImageList(ctx, types.ImageListOptions{})
	if err != nil {
		return fmt.Errorf("error executing docker image ls: %v. %s", err, mountDockerSockMsg)
	}

	logging.Debug("[airbyte] pulled docker images:")
	for _, image := range images {
		if len(image.RepoTags) > 0 {
			repoImageWithVersion := image.RepoTags[0]
			logging.Debug(repoImageWithVersion)
			Instance.pulledImages[repoImageWithVersion] = true
		}
	}

	if host := os.Getenv("DOCKER_HOST"); host != "" {
		logging.Infof("[airbyte] ✅ DOCKER_HOST env variable found. Presumably running in Docker in Docker mode.")
		return nil
	}

	logging.Infof("[airbyte] Checking mounted volume: %s ...", workspaceVolume)
	if containerizedRun {
		if err = Instance.checkVolume(ctx, cli); err != nil {
			return err
		}
	} else {
		if Instance.ConfigDir != workspaceVolume {
			return fmt.Errorf("for non-docker Jitsu instances (started via binary file) 'airbyte-bridge.config_dir' parameter (current value: %s) should be equal to 'server.volumes.workspace' parameter (current value: %s) in config", Instance.ConfigDir, workspaceVolume)
		}
	}

	logging.Infof("[airbyte] ✅ Mounted volume %s: OK", workspaceVolume)

	return nil
}

//checkVolume checks if current image has a mounted volume with server.volumes.workspace value
func (b *Bridge) checkVolume(ctx context.Context, cli *client.Client) error {
	containerID, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("failed to get current docker container ID from hostname: %v", err)
	}

	container, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return fmt.Errorf("failed to inspect current docker container by containerID [%s]: %v", containerID, err)
	}

	for _, mount := range container.Mounts {
		if mount.Name == b.WorkspaceVolume && mount.Type == MountVolumeType {
			//workspace is a volume and has correct name
			return nil
		}
	}

	return fmt.Errorf("volume with name: %s hasn't been mounted to the current docker container. The volume is required for Airbyte integration. Please add -v %s:%s to your Jitsu container run", Instance.WorkspaceVolume, Instance.WorkspaceVolume, Instance.ConfigDir)
}

//IsImagePulled returns true if the image is pulled or start pulling the image asynchronously and returns false
func (b *Bridge) IsImagePulled(dockerRepoImage, version string) bool {
	dockerVersionedImage := fmt.Sprintf("%s:%s", dockerRepoImage, version)
	b.imageMutex.RLock()
	_, exist := b.pulledImages[dockerVersionedImage]
	b.imageMutex.RUnlock()
	if exist {
		return true
	}

	//or do pull
	if _, exists := b.pullingImages.LoadOrStore(dockerVersionedImage, true); !exists {
		safego.Run(func() {
			b.pullImage(dockerVersionedImage)
		})
	}

	return false
}

//pullImage executes docker pull
func (b *Bridge) pullImage(dockerVersionedImage string) {
	defer b.pullingImages.Delete(dockerVersionedImage)

	pullImgOutWriter := logging.NewStringWriter()
	pullImgErrWriter := logging.NewStringWriter()

	//pull last image
	if err := runner.ExecCmd(BridgeType, DockerCommand, pullImgOutWriter, pullImgErrWriter, time.Minute*30, "pull", dockerVersionedImage); err != nil {
		errMsg := b.BuildMsg("Error pulling airbyte image:", pullImgOutWriter, pullImgErrWriter, err)
		logging.SystemError(errMsg)

		return
	}

	b.imageMutex.Lock()
	b.pulledImages[dockerVersionedImage] = true
	b.imageMutex.Unlock()
}

//BuildMsg returns formatted error
func (b *Bridge) BuildMsg(prefix string, outWriter, errWriter *logging.StringWriter, err error) string {
	msg := prefix
	var outStr, errStr string
	if outWriter != nil {
		outStr = outWriter.String()
	}
	if errWriter != nil {
		errStr = errWriter.String()
	}
	if outStr != "" {
		if msg != "" {
			msg += "\n\t"
		}
		msg += outStr
	}
	if errStr != "" {
		if msg != "" {
			msg += "\n\t"
		}
		msg += errStr
	}
	return fmt.Sprintf("%s\n\t%v", msg, err)
}

//AddAirbytePrefix adds airbyte/ prefix to dockerImage if doesn't exist
func (b *Bridge) AddAirbytePrefix(dockerImage string) string {
	if !strings.HasPrefix(dockerImage, DockerImageRepositoryPrefix) {
		return DockerImageRepositoryPrefix + dockerImage
	}

	return dockerImage
}
