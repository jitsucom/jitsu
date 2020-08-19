package storages

import (
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"io/ioutil"
	"log"
	"os"
	"path"
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
				filePath := path.Join(fr.storage.SourceDir(), f.Name())
				b, err := ioutil.ReadFile(filePath)
				if err != nil {
					log.Println("Error reading file", filePath, err)
					continue
				}
				if len(b) == 0 {
					os.Remove(filePath)
					continue
				}

				if err := fr.storage.Store(f.Name(), b); err != nil {
					log.Println("Error store file", filePath, "in", fr.storage.Name(), "destination:", err)
					continue
				}

				os.Remove(filePath)
			}
		}
	}()
}
