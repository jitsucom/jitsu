package plugins

import (
	"encoding/json"
	"fmt"
	"github.com/Masterminds/semver"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/mitchellh/mapstructure"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"os/exec"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var tarballUrlRegex = regexp.MustCompile(`^.*\.(?:tar|tar\.gz|tgz)$`)
var tarballJsonPath = jsonutils.NewJSONPath("/dist/tarball")
var pluginsCache = map[string]CachedPlugin{}
var pluginsRWMutex = sync.RWMutex{}
var cacheTTL = time.Duration(5) * time.Minute

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
	Version    string
	Code       string
	Descriptor map[string]interface{}
	BuildInfo  BuildInfo
}

type BuildInfo struct {
	SdkVersion     string `mapstructure:"sdkVersion"`
	SdkPackage     string `mapstructure:"sdkPackage"`
	BuildTimestamp string `mapstructure:"buildTimestamp"`
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
	var err error
	if tarballUrlRegex.MatchString(packageString) {
		//full tarball url was provided instead of version
		tarballUrl = packageString
		logging.Infof("Provided tarball URL: %s", tarballUrl)
	} else {
		//use npm view to detect tarball ur
		logging.Infof("Fetching tarball url for: %s", packageString)
		tarballUrl, err = fetchTarballUrl(packageString)
		if err != nil {
			return nil, fmt.Errorf("cannot install plugin %s: %v", packageString, err)
		}
		logging.Infof("Tarball URL from npm: %s", tarballUrl)
	}
	return downloadPlugin(packageString, tarballUrl)
}

func fetchTarballUrl(packageString string) (string, error) {
	packageName := packageString
	packageVersion := ""
	var versionConstraint *semver.Constraints
	var err error
	iof := strings.LastIndex(packageString, "@")
	if iof > 0 {
		packageName = packageString[:iof]
		packageVersion = packageString[iof+1:]
		if packageVersion != "" {
			versionConstraint, err = semver.NewConstraint(packageVersion)
			if err != nil {
				return "", fmt.Errorf("failed to parse requested version info: %s err: %v", packageVersion, err)
			}
		}
	}
	req, err := http.NewRequest("GET", "https://registry.npmjs.org/"+packageName+"/", nil)
	if err != nil {
		return "", err
	}
	req.Header.Add("Accept", "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to access npmjs repository: %v", err)
	}
	status := resp.StatusCode
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read npmjs repository response (%d): %v", status, err)
	}
	if status != http.StatusOK {
		if status == http.StatusNotFound {
			return "", fmt.Errorf("package not found (%d): %s", status, body)
		}
		return "", fmt.Errorf("failed to read npmjs repository response (%d): %v", status, err)
	}
	respJson := map[string]interface{}{}
	err = json.Unmarshal(body, &respJson)
	if err != nil {
		return "", fmt.Errorf("failed to unmarshall npmjs repository response: %v", err)
	}
	versions, ok := respJson["versions"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("failed to get versions data from npmjs repository response")

	}
	matchedVersions := make([]*semver.Version, 0)
	for k, _ := range versions {
		v, err := semver.NewVersion(k)
		if err != nil {
			logging.SystemErrorf("failed to parse package version %s as semver for %s err: %v", v, packageName, err)
			continue
		}
		if versionConstraint == nil || versionConstraint.Check(v) {
			matchedVersions = append(matchedVersions, v)
		}
	}
	if len(matchedVersions) == 0 {
		return "", fmt.Errorf("no versions match requested: %s for package: %s", packageVersion, packageName)
	}
	sort.Sort(sort.Reverse(semver.Collection(matchedVersions)))
	logging.Infof("Matched versions for package %s (%s): %s", packageName, packageVersion, matchedVersions)
	matched := matchedVersions[0]
	tarballObj, err := utils.ExtractObject(versions, matched.Original(), "dist", "tarball")
	if err != nil {
		return "", fmt.Errorf("failed to extract tarball url from package versions data %s (%s) err: %v", packageVersion, packageName, err)
	}
	tarballString, ok := tarballObj.(string)
	if err != nil {
		return "", fmt.Errorf("tarball data for %s (%s) is not string: %T", packageVersion, packageName, tarballObj)
	}
	return tarballString, nil
}

func downloadPlugin(packageString, tarballUrl string) (*Plugin, error) {
	dir, err := os.MkdirTemp("", "plugin")
	if err != nil {
		return nil, fmt.Errorf("failed to create tmp dir to extract plugin: %v", err)
	}
	defer os.RemoveAll(dir) // clean up
	logging.Infof("Created tmp dir: %s", dir)

	var filename = ""
	var source io.Reader
	if strings.HasPrefix(tarballUrl, "http") {
		logging.Infof("Downloading: %s", tarballUrl)
		resp, err := http.Get(tarballUrl)
		if err != nil {
			return nil, fmt.Errorf("cannot install plugin %s: failed to download tarball: %s : %v", packageString, tarballUrl, err)
		}
		defer resp.Body.Close()
		contentDisposition := resp.Header.Get("content-disposition")
		contentDisposition = strings.ReplaceAll(contentDisposition, "attachment; filename=", "")
		if contentDisposition != "" {
			filename = contentDisposition
		} else {
			urlParts := strings.Split(resp.Request.URL.String(), "/")
			filename = urlParts[len(urlParts)-1]
		}
		source = resp.Body
	} else {
		logging.Infof("Copying: %s", tarballUrl)
		filename = path.Base(tarballUrl)
		sourceFile, err := os.Open(tarballUrl)
		if err != nil {
			return nil, err
		}
		defer sourceFile.Close()
		source = sourceFile
	}
	// Create tmp file
	out, err := os.Create(path.Join(dir, filename))
	if err != nil {
		return nil, err
	}
	defer out.Close()

	// Write the body to file
	_, err = io.Copy(out, source)
	if err != nil {
		return nil, err
	}
	_ = out.Sync()
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
	exportsValue, err := templates.V8EvaluateCode(`exports`, nil, code)
	if err != nil {
		return nil, fmt.Errorf("cannot install plugin %s: error running main script: %v", packageString, err)
	}
	exports, ok := exportsValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: failed to convert exports object to go map[string]interface{}. Actual type: %T", packageString, exportsValue)
	}
	descriptorValue, ok := exports["descriptor"]
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: Descriptor is not found in exported objects: %s", packageString, exports)
	}
	descriptor, ok := descriptorValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("cannot install plugin %s: failed to convert desriptor object to go map[string]interface{}. Actual type: %T", packageString, descriptorValue)
	}
	logging.Infof("Descriptor:  %s", descriptor)
	name, ok := descriptor["id"].(string)
	if !ok {
		name, ok = descriptor["type"].(string)
		if !ok {
			return nil, fmt.Errorf("cannot install plugin %s: no id or type provided in descriptor: %s", packageString, descriptorValue)
		}
	}
	buildInfo := BuildInfo{}
	buildInfoValue, ok := exports["buildInfo"]
	if ok {
		err := mapstructure.Decode(buildInfoValue, &buildInfo)
		if err != nil {
			return nil, fmt.Errorf("cannot install plugin %s: failed to parse buildInfo object : %s", packageString, buildInfoValue)
		}
	}
	version, ok := pckgMap["version"].(string)
	logging.Infof("Loaded Plugin: %s Version: %s BuildInfo: %+v", name, version, buildInfo)

	plugin := &Plugin{Name: name, Version: version, Code: code, Descriptor: descriptor, BuildInfo: buildInfo}
	pluginsRWMutex.Lock()
	defer pluginsRWMutex.Unlock()
	pluginsCache[packageString] = CachedPlugin{
		Plugin: plugin,
		Added:  timestamp.Now(),
	}
	return plugin, nil
}

func GetCached(packageString string) *Plugin {
	pluginsRWMutex.RLock()
	cached, ok := pluginsCache[packageString]
	pluginsRWMutex.RUnlock()
	if !ok {
		return nil
	}
	if timestamp.Now().Sub(cached.Added) > cacheTTL {
		logging.Infof("Cache expired. Plugin: %s time added: %s", packageString, cached.Added)
		pluginsRWMutex.Lock()
		delete(pluginsCache, packageString)
		pluginsRWMutex.Unlock()
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
