package entities

import "github.com/jitsucom/jitsu/configurator/openapi"

type Project struct {
	openapi.Project
	openapi.ProjectSettings
}

func (p *Project) ObjectType() string {
	return "project_settings"
}

func (p *Project) OnCreate(id string) {
	p.Id = id
	requiresSetup := true
	p.RequiresSetup = &requiresSetup
}
