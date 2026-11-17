package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in Linux PID-1 tests. Images must already exist locally; no implicit pulls.
// JITSU_TEST_DOCKER=1 go test -run TestConnectorSupervisorInContainer ./sync-controller
func TestConnectorSupervisorInContainer(t *testing.T) {
	if os.Getenv("JITSU_TEST_DOCKER") != "1" {
		t.Skip("set JITSU_TEST_DOCKER=1 for real PID-namespace tests")
	}
	for _, image := range []string{"alpine:3.22", "python:3.12-slim"} {
		for _, mode := range []string{"complete", "lease-lost", "term"} {
			t.Run(image+"/"+mode, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
				defer cancel()
				docker := func(args ...string) string {
					t.Helper()
					out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
					if err != nil {
						t.Fatalf("docker %v: %v: %s", args, err, out)
					}
					return strings.TrimSpace(string(out))
				}
				dir := t.TempDir()
				if err := os.Chmod(dir, 0777); err != nil {
					t.Fatal(err)
				}
				script := "exit 3\n"
				if mode == "term" {
					script = "trap 'sleep 1; touch /test/flushed; exit 0' TERM\ntouch /test/ready\nwhile :; do sleep 0.1; done\n"
				}
				if mode == "lease-lost" {
					script = "trap '' TERM\nsleep 300 &\ntouch /test/ready\nwait\n"
				}
				if err := os.WriteFile(filepath.Join(dir, "connector.sh"), []byte(script), 0644); err != nil {
					t.Fatal(err)
				}
				name := fmt.Sprintf("jitsu-260-%d", time.Now().UnixNano())
				command := terminableCommand("exec sh /test/connector.sh", "/test/terminate")
				docker("run", "-d", "--pull=never", "--name", name, "--user", "65534:65534", "--mount", "type=bind,src="+dir+",dst=/test", "--entrypoint", "sh", image, "-c", command)
				t.Cleanup(func() {
					cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
					defer stop()
					_ = exec.CommandContext(cleanupCtx, "docker", "rm", "-f", name).Run()
				})
				want := "3"
				if mode != "complete" {
					for {
						if _, err := os.Stat(filepath.Join(dir, "ready")); err == nil {
							break
						}
						if ctx.Err() != nil {
							t.Fatal("connector never became ready")
						}
						time.Sleep(25 * time.Millisecond)
					}
					want = "143"
					if mode == "term" {
						docker("kill", "--signal=TERM", name)
					} else if err := os.WriteFile(filepath.Join(dir, "terminate"), nil, 0644); err != nil {
						t.Fatal(err)
					}
				}
				if got := docker("wait", name); got != want {
					t.Fatalf("exit %q, want %q; logs: %s", got, want, docker("logs", name))
				}
				if mode == "term" {
					if _, err := os.Stat(filepath.Join(dir, "flushed")); err != nil {
						t.Fatal("connector cleanup was interrupted")
					}
				}
			})
		}
	}
}
