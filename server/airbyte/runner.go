package airbyte

import "time"

//Runner is an Airbyte Docker runner
type Runner struct {
	DockerImage string
	Version     string
}

//NewRunner returns configured Airbyte Runner
func NewRunner(dockerImage, imageVersion string) *Runner {
	return &Runner{
		DockerImage: dockerImage,
		Version:     imageVersion,
	}
}

func (r *Runner) Spec() {

}

func (r *Runner) Check() {

}

func (r *Runner) Discover() {

}

func (r *Runner) Read() {

}

func (r *Runner) Kill(command string, timeout time.Duration) {

}

func (r *Runner) run(command string, timeout time.Duration) {

}
