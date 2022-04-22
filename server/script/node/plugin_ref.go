package node

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/jitsucom/jitsu/server/safego"
	"github.com/pkg/errors"
)

type pluginRef struct {
	plugin string
	main   string
	err    error
	once   sync.Once
	work   sync.WaitGroup
}

func (r *pluginRef) get() (string, error) {
	r.once.Do(func() {
		r.work.Add(1)
		safego.Run(func() {
			defer r.work.Done()
			r.main, r.err = r.load()
		})
	})

	r.work.Wait()
	return r.main, r.err
}

func (r *pluginRef) load() (string, error) {
	dir, err := os.MkdirTemp(os.TempDir(), "jitsu-plugin-")
	if err != nil {
		return "", errors.Wrapf(err, "create temp dir for plugin [%s]", r.plugin)
	}

	defer os.RemoveAll(dir)
	if err := installNodeModule(dir, r.plugin); err != nil {
		return "", errors.Wrapf(err, "install [%s] in temp dir", r.plugin)
	}

	packageJSON, err := readPackageJSON(dir)
	if err != nil {
		return "", errors.Wrap(err, "read temp package.json")
	}

	if len(packageJSON.Dependencies) != 1 {
		return "", errors.Wrapf(err, "expected exactly 1 dependency, got %d", len(packageJSON.Dependencies))
	}

	var packageName string
	for name := range packageJSON.Dependencies {
		packageName = name
		break
	}

	packageDir := filepath.Join(dir, "node_modules", packageName)
	packageJSON, err = readPackageJSON(packageDir)
	if err != nil {
		return "", errors.Wrapf(err, "read package.json from [%s]", r.plugin)
	}

	data, err := os.ReadFile(filepath.Join(packageDir, packageJSON.Main))
	if err != nil {
		return "", errors.Wrapf(err, "read main file [%s] from [%s]", packageJSON.Main, r.plugin)
	}

	return string(data), nil
}
