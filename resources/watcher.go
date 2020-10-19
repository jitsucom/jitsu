package resources

import (
	"crypto/md5"
	"fmt"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/logging"
	"time"
)

type Watcher struct {
	name         string
	hash         string
	source       string
	lastModified string
	reloadEvery  time.Duration

	loadFunc func(string, string) ([]byte, string, error)
	consumer func([]byte)
}

//First load source then run goroutine to reload source every 'reloadEvery' duration
//On every load check if content was changed => run consumer otherwise do nothing
func Watch(name, source string, loadFunc func(string, string) ([]byte, string, error), consumer func([]byte), reloadEvery time.Duration) func() {
	w := &Watcher{
		name:         name,
		hash:         "",
		source:       source,
		lastModified: "",
		loadFunc:     loadFunc,
		consumer:     consumer,
		reloadEvery:  reloadEvery,
	}
	logging.Infof("Resource [%s] will be loaded every %d seconds", name, int(reloadEvery.Seconds()))
	w.watch()
	return w.forceReload
}

func (w *Watcher) watch() {
	w.download()
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}

			time.Sleep(w.reloadEvery)

			w.download()
		}
	}()
}

func (w *Watcher) download() {
	payload, lastModified, err := w.loadFunc(w.source, w.lastModified)
	if err == ErrNoModified {
		return
	}

	if err != nil {
		logging.Errorf("Error reloading resource [%s]: %v", w.name, err)
		return
	}

	w.lastModified = lastModified

	newHash := GetHash(payload)
	if w.hash != newHash {
		w.hash = newHash
		w.consumer(payload)
		logging.Infof("New resource [%s] has been loaded", w.name)
	}
}

func (w *Watcher) forceReload() {
	w.hash = ""
	w.lastModified = ""
}

func GetHash(payload []byte) string {
	return fmt.Sprintf("%x", md5.Sum(payload))
}
