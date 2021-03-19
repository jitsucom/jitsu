package logfiles

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"path"
	"path/filepath"
	"time"
)

//PeriodicArchiver archive log files every configurable unit of time
//uses Archiver under the hood
type PeriodicArchiver struct {
	fileMask     string
	archiver     *Archiver
	archiveEvery time.Duration

	closed bool
}

//NewPeriodicArchiver return PeriodicArchiver and start observer goroutine
func NewPeriodicArchiver(fileMask, archiveDir string, archiveEvery time.Duration) *PeriodicArchiver {
	pa := &PeriodicArchiver{
		fileMask:     path.Join(archiveDir, fileMask),
		archiver:     NewArchiver(archiveDir, archiveDir),
		archiveEvery: archiveEvery,
	}

	pa.start()

	return pa
}

func (pa *PeriodicArchiver) start() {
	safego.RunWithRestart(func() {
		for {
			if pa.closed {
				break
			}

			files, err := filepath.Glob(pa.fileMask)
			if err != nil {
				logging.SystemErrorf("Error finding files for archiving by %s mask: %v", pa.fileMask, err)
				return
			}

			for _, filePath := range files {
				err := pa.archiver.ArchiveByPath(filePath)
				if err != nil {
					logging.SystemErrorf("Error archiving [%s] file: %v", filePath, err)
				}
			}

			time.Sleep(pa.archiveEvery)
		}
	})
}

func (pa *PeriodicArchiver) Close() error {
	pa.closed = true

	return nil
}
