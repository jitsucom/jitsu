package plugins

import (
	"encoding/json"
	"fmt"
	"github.com/dop251/goja"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"
)

var tarballUrlRegex = regexp.MustCompile(`^http.*\.(?:tar|tar\.gz|tgz)$`)
var tarballJsonPath = jsonutils.NewJSONPath("/dist/tarball")


type PluginsRepository interface {
	GetPlugins() map[string]*Plugin
	Get(name string) *Plugin
}

type PluginsRepositoryImp struct {
	plugins map[string]*Plugin
}

type Plugin struct {
	Name string
	Code string
	Descriptor map[string]interface{}
}

func NewPluginsRepository(pluginsMap map[string]string, cacheDir string) (PluginsRepository, error) {
	plugins := map[string]*Plugin{}

	for name, version := range pluginsMap {
		var tarballUrl string
		logging.Infof("Loading plugin: %s", name)
		if tarballUrlRegex.MatchString(version) {
			//full tarball url was provided instead of version
			tarballUrl = version
			logging.Infof("Provided tarball URL: %s", tarballUrl)
		} else {
			//use npm view to detect tarball ur
			logging.Infof("Running npm view for: %s", version)
			command := exec.Command("npm", "view", version, "--json")
			command.Stderr = os.Stderr
			outputBuf, err := command.Output()
			if err != nil {
				return nil, fmt.Errorf("cannot install plugin %s: npm view failed on %s : %v", name, version, err)
			}
			if len(outputBuf) == 0 {
				return nil, fmt.Errorf("cannot install plugin %s: no version found: %s", name, version)
			}
			npmView := map[string]interface{}{}
			if err := json.Unmarshal(outputBuf, &npmView); err != nil {
				return nil, fmt.Errorf("cannot install plugin %s: failed to parse npm view result: %v", name, err)
			}
			tbRaw, ok := tarballJsonPath.Get(npmView)
			if !ok {
				return nil, fmt.Errorf("cannot install plugin %s: cannot find tarball url in npmv view for: %v", name, version)
			}
			tarballUrl = tbRaw.(string)
			logging.Infof("Tarball URL from npm: %s", tarballUrl)
		}
		plugin, err := downloadPlugin(name, tarballUrl)
		if err != nil {
			return nil, err
		}
		plugins[name] = plugin
	}
	return &PluginsRepositoryImp{plugins: plugins},nil
}

func downloadPlugin(name, tarballUrl string) (*Plugin, error) {
	logging.Infof("Downloading: %s", tarballUrl)

	resp, err := http.Get(tarballUrl)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: failed to download tarball: %s : %v", name, tarballUrl, err)
	}
	defer resp.Body.Close()

	contentDisposition := resp.Header.Get("content-disposition")
	contentDisposition = strings.ReplaceAll(contentDisposition, "attachment; filename=", "")
	var filename = name + ".tar.gz"
	if contentDisposition != "" {
		filename = contentDisposition
	}
	dir, err := os.MkdirTemp("", name)
	logging.Infof("Created tmp dir: %s", dir)
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir) // clean up

	// Create the file
	out, err := os.Create(path.Join(dir, filename))
	if err != nil {
		return nil, err
	}
	defer out.Close()

	// Write the body to file
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return nil, err
	}
	logging.Infof("Extracting: %s", filename)
	command := exec.Command("tar", "--strip-components","1","-xf", filename)
	command.Dir = dir
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	err = command.Run()
	if err != nil {
		return nil, err
	}
	logging.Infof("Opening package.json")
	pckgBytes, err :=  os.ReadFile(path.Join(dir, "package.json"))
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: failed to open package.json: %v", name, err)
	}
	pckgMap := map[string]interface{}{}
	err = json.Unmarshal(pckgBytes, &pckgMap)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: failed to unmarshal package.json: %v", name, err)
	}
	mainRaw, ok := pckgMap["main"]
	logging.Infof("package.json main: %s", mainRaw)
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: main node is required in package.json: %v", name, err)
	}
	var mainFile string
	switch main := mainRaw.(type) {
	case string:
		mainFile = path.Join(dir, main)
	case []string:
		if len(main) != 1 {
			return nil, fmt.Errorf("cannot install plugin %s: main node must contain one file. Found: %s", name, mainRaw)
		}
		mainFile = path.Join(dir, main[0])
	default:
		return nil, fmt.Errorf("cannot install plugin %s: main node must contain one file. Found: %s", name, mainRaw)
	}
	logging.Infof("Opening main file: %s", mainFile)
	dist, err := os.ReadFile(mainFile)
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: cannot open main file: %s : %v", name, mainFile, err)
	}
	code := string(dist)
	logging.Debug("Main File: %s", code)
	vm := goja.New()
	exports := map[string]interface{}{}
	_ = vm.Set("exports", exports)
	_, err = vm.RunString(code)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: error running main script: %v", name, err)
	}
	descriptorValue, ok := exports["descriptor"]
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: descriptor is not exported: %v", name, err)
	}
	descriptor, ok := descriptorValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: failed to convert desriptor object to go map[string]interface{}. Actual type: %T", name, descriptorValue)
	}
	logging.Infof("Descriptor:  %s", descriptor)
	return &Plugin{Name: name, Code: code, Descriptor: descriptor}, nil
}

func (rep *PluginsRepositoryImp) GetPlugins() map[string]*Plugin {
	return rep.plugins
}

func (rep *PluginsRepositoryImp) Get(name string) *Plugin {
	return rep.plugins[name]
}