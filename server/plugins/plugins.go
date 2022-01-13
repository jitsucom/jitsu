package plugins

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strings"
	"time"
)

var tarballUrlRegex = regexp.MustCompile(`^http.*\.(?:tar|tar\.gz|tgz)$`)
var tarballJsonPath = jsonutils.NewJSONPath("/dist/tarball")
var pluginsCache = map[string]CachedPlugin{}
var cacheTTL = time.Duration(1) * time.Hour

type PluginsRepository interface {
	GetPlugins() map[string]*Plugin
	Get(name string) *Plugin
}

type PluginsRepositoryImp struct {
	plugins map[string]*Plugin
}

type CachedPlugin struct {
	Added  time.Time
	Plugin *Plugin
}

type Plugin struct {
	Name       string
	Code       string
	Descriptor map[string]interface{}
}

func NewPluginsRepository(pluginsMap map[string]string, cacheDir string) (PluginsRepository, error) {
	plugins := map[string]*Plugin{}

	for name, version := range pluginsMap {
		plugin, err := DownloadPlugin(version)
		if err != nil {
			return nil, err
		}
		plugins[name] = plugin
	}
	return &PluginsRepositoryImp{plugins: plugins}, nil
}
func DownloadPlugin(packageString string) (*Plugin, error) {
	logging.Infof("Loading plugin: %s", packageString)
	if plugin := GetCached(packageString); plugin != nil {
		return plugin, nil
	}
	var tarballUrl string
	if tarballUrlRegex.MatchString(packageString) {
		//full tarball url was provided instead of version
		tarballUrl = packageString
		logging.Infof("Provided tarball URL: %s", tarballUrl)
	} else {
		//use npm view to detect tarball ur
		logging.Infof("Running npm view for: %s", packageString)
		command := exec.Command("npm", "view", packageString, "--json")
		command.Stderr = os.Stderr
		outputBuf, err := command.Output()
		if err != nil {
			return nil, fmt.Errorf("cannot install plugin %s: npm view failed: %v", packageString, err)
		}
		if len(outputBuf) == 0 {
			return nil, fmt.Errorf("cannot install plugin %s: no version found.", packageString)
		}
		npmView := map[string]interface{}{}
		if outputBuf[0] == '[' {
			npmViewArr := make([]map[string]interface{}, 0)
			if err := json.Unmarshal(outputBuf, &npmViewArr); err != nil {
				return nil, fmt.Errorf("cannot install plugin %s: failed to parse npm view result: %v", packageString, err)
			}
			if len(npmViewArr) > 0 {
				npmView = npmViewArr[len(npmViewArr)-1]
			}
		} else {
			if err := json.Unmarshal(outputBuf, &npmView); err != nil {
				return nil, fmt.Errorf("cannot install plugin %s: failed to parse npm view result: %v", packageString, err)
			}
		}
		tbRaw, ok := tarballJsonPath.Get(npmView)
		if !ok {
			return nil, fmt.Errorf("cannot install plugin %s: cannot find tarball url in npmv view for: %v", packageString, packageString)
		}
		tarballUrl = tbRaw.(string)
		logging.Infof("Tarball URL from npm: %s", tarballUrl)
	}
	return downloadPlugin(packageString, tarballUrl)
}

func downloadPlugin(packageString, tarballUrl string) (*Plugin, error) {
	logging.Infof("Downloading: %s", tarballUrl)

	resp, err := http.Get(tarballUrl)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: failed to download tarball: %s : %v", packageString, tarballUrl, err)
	}
	defer resp.Body.Close()
	contentDisposition := resp.Header.Get("content-disposition")
	contentDisposition = strings.ReplaceAll(contentDisposition, "attachment; filename=", "")
	var filename = ""
	if contentDisposition != "" {
		filename = contentDisposition
	} else {
		urlParts := strings.Split(resp.Request.URL.String(), "/")
		filename = urlParts[len(urlParts)-1]
	}
	dir, err := os.MkdirTemp("", "plugin")
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
	command := exec.Command("tar", "--strip-components", "1", "-xf", filename)
	command.Dir = dir
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	err = command.Run()
	if err != nil {
		return nil, err
	}
	logging.Infof("Opening package.json")
	pckgBytes, err := os.ReadFile(path.Join(dir, "package.json"))
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: failed to open package.json: %v", packageString, err)
	}
	pckgMap := map[string]interface{}{}
	err = json.Unmarshal(pckgBytes, &pckgMap)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: failed to unmarshal package.json: %v", packageString, err)
	}
	mainRaw, ok := pckgMap["main"]
	logging.Infof("package.json main: %s", mainRaw)
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: main node is required in package.json: %v", packageString, err)
	}
	var mainFile string
	switch main := mainRaw.(type) {
	case string:
		mainFile = path.Join(dir, main)
	case []string:
		if len(main) != 1 {
			return nil, fmt.Errorf("cannot install plugin %s: main node must contain one file. Found: %s", packageString, mainRaw)
		}
		mainFile = path.Join(dir, main[0])
	default:
		return nil, fmt.Errorf("cannot install plugin %s: main node must contain one file. Found: %s", packageString, mainRaw)
	}
	logging.Infof("Opening main file: %s", mainFile)
	dist, err := os.ReadFile(mainFile)
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: cannot open main file: %s : %v", packageString, mainFile, err)
	}
	code := string(dist)
	logging.Debug("Main File: %s", code)
	descriptorValue, err := templates.V8EvaluateCode(`exports["descriptor"]`, nil, code)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: error running main script: %v", packageString, err)
	}
	descriptor, ok := descriptorValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: failed to convert desriptor object to go map[string]interface{}. Actual type: %T", packageString, descriptorValue)
	}
	logging.Infof("Descriptor:  %s", descriptor)
	plugin := &Plugin{Name: descriptor["id"].(string), Code: code, Descriptor: descriptor}
	pluginsCache[packageString] = CachedPlugin{
		Plugin: plugin,
		Added:  timestamp.Now(),
	}
	return plugin, nil
}

func GetCached(packageString string) *Plugin {
	cached, ok := pluginsCache[packageString]
	if !ok {
		return nil
	}
	if timestamp.Now().Sub(cached.Added) > cacheTTL {
		logging.Infof("Cache expired. Plugin: %s time added: %s", packageString, cached.Added)
		delete(pluginsCache, packageString)
		return nil
	}
	logging.Infof("Cache hit. Plugin: %s time added: %s", packageString, cached.Added)
	return cached.Plugin
}

func (rep *PluginsRepositoryImp) GetPlugins() map[string]*Plugin {
	if rep == nil {
		return nil
	}
	return rep.plugins
}

func (rep *PluginsRepositoryImp) Get(name string) *Plugin {
	if rep == nil {
		return nil
	}
	return rep.plugins[name]
}
