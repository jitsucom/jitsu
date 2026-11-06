package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestTerminatePodFallback(t *testing.T) {
	if os.Getenv("JITSU_TEST_TERMINATE_HELPER") == "1" {
		terminatePod()
		return
	}
	for _, kind := range []string{"sentinel", "write-failure", "disabled", "existing", "symlink", "dangling-symlink", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "terminate")
			if kind == "write-failure" {
				path = filepath.Join(path, "missing", "terminate")
			}
			if kind == "disabled" {
				path = ""
			}
			target := filepath.Join(t.TempDir(), "sidecar-file")
			if kind == "symlink" {
				if err := os.WriteFile(target, []byte("unchanged"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "dangling-symlink" {
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "fifo" {
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "existing" {
				if err := os.WriteFile(path, nil, 0600); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("TERMINATE_SENTINEL", path)
			t.Setenv("JITSU_TEST_TERMINATE_HELPER", "1")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTerminatePodFallback$")
			err := cmd.Run()
			var exitErr *exec.ExitError
			if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
				t.Fatalf("must exit 1 for controller cleanup: %v", err)
			}
			if kind == "symlink" {
				data, err := os.ReadFile(target)
				if err != nil || string(data) != "unchanged" {
					t.Fatalf("overwrote sidecar file: %q %v", data, err)
				}
			}
			if kind == "dangling-symlink" {
				if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("created symlink target: %v", err)
				}
			}
			if kind == "sentinel" {
				if _, err := os.Stat(path); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
