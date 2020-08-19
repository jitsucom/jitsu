package storages

import (
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"time"
)

type FileReader struct {
	dir     string
	storage events.Storage
}

//Periodically (every 20 seconds) read files from dir, pass them to storage and remove if no err
func (fr *FileReader) start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			//TODO configurable
			time.Sleep(20 * time.Second)

			files, err := ioutil.ReadDir(fr.storage.SourceDir())
			if err != nil {
				log.Println("Error finding files in dir", fr.storage.SourceDir(), err)
				return
			}

			for _, f := range files {
				b, err := ioutil.ReadFile(f.Name())
				if err != nil {
					log.Println("Error reading file", f.Name(), err)
					continue
				}
				if len(b) == 0 {
					os.Remove(f.Name())
					continue
				}

				if err := fr.storage.Store(filepath.Base(f.Name()), b); err != nil {
					log.Println("Error store file", f.Name(), "in", fr.storage.Name(), "destination:", err)
					continue
				}

				os.Remove(f.Name())
			}
		}
	}()
}
