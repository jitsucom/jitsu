package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"testing"

	"github.com/jitsucom/bulker/airbytecdk"
)

func TestFirebase(t *testing.T) {
	os.Args = []string{os.Args[0], "spec"}
	hsrc := NewFirebaseSource()
	runner := airbyte.NewSourceRunner(hsrc, os.Stdout)
	err := runner.Start()
	if err != nil {
		t.Error(err)
	}

	//write config to tmp file
	config := FirebaseConfig{
		ProjectID: "",
		ServiceAccountKey: `{	
}`,
	}
	tmpfile, err := ioutil.TempFile("", "firebase")
	if err != nil {
		t.Error(err)
	}
	defer os.Remove(tmpfile.Name())

	b, _ := json.Marshal(config)

	if _, err := tmpfile.Write(b); err != nil {
		t.Error(err)
	}
	fmt.Println("tmp file:" + tmpfile.Name())

	os.Args = []string{os.Args[0], "check", "--config", tmpfile.Name()}

	err = runner.Start()
	if err != nil {
		t.Error(err)
	}

	os.Args = []string{os.Args[0], "discover", "--config", tmpfile.Name()}

	err = runner.Start()
	if err != nil {
		t.Error(err)
	}

	os.Args = []string{os.Args[0], "read", "--config", tmpfile.Name()}

	err = runner.Start()
	if err != nil {
		t.Error(err)
	}

}
