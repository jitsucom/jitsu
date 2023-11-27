package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/safego"
	"io/fs"
	"io/ioutil"
	"sync"
	"time"
)

//StateManager is a file uploading state manager
type StateManager struct {
	mutex *sync.RWMutex

	stateFilePath string
	state         map[string]bool
	closed        chan struct{}
}

func newStateManager(stateFilePath string) (*StateManager, error) {
	sm := &StateManager{
		mutex:         &sync.RWMutex{},
		stateFilePath: stateFilePath,
		state:         make(map[string]bool),
		closed:        make(chan struct{}),
	}

	if err := sm.readState(); err != nil {
		return nil, err
	}

	safego.Run(sm.persist)

	return sm, nil
}

func (sm *StateManager) persist() {
	ticker := time.NewTicker(time.Second)
	for {
		select {
		case <-sm.closed:
			return
		case <-ticker.C:
			sm.mutex.Lock()
			if err := sm.writeState(); err != nil {
				fmt.Println("error writing state:", err)
			}
			sm.mutex.Unlock()
		}
	}
}

//IsUploaded returns true if input file has already been uploaded
func (sm *StateManager) IsUploaded(fileName string) bool {
	sm.mutex.RLock()
	uploaded, ok := sm.state[fileName]
	sm.mutex.RUnlock()
	return ok && uploaded
}

func (sm *StateManager) Success(fileName string) {
	sm.mutex.Lock()
	sm.state[fileName] = true
	sm.mutex.Unlock()
}

//readState reads state file and enrich inner map
//returns err if occurred
func (sm *StateManager) readState() error {
	if sm.stateFilePath == "" {
		return nil
	}

	b, err := ioutil.ReadFile(sm.stateFilePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}

		return err
	}

	stateMap := map[string]bool{}
	if err := json.Unmarshal(b, &stateMap); err != nil {
		return err
	}

	sm.state = stateMap
	return nil
}

//writeState overwrites state file with updated values
func (sm *StateManager) writeState() error {
	if sm.stateFilePath == "" {
		return nil
	}

	b, err := json.Marshal(sm.state)
	if err != nil {
		return err
	}

	return ioutil.WriteFile(sm.stateFilePath, b, 0644)
}

func (sm *StateManager) Close() {
	select {
	case <-sm.closed:
		return
	default:
		close(sm.closed)
	}
}
