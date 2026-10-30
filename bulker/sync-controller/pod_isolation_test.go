package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	v1 "k8s.io/api/core/v1"
)

func isolationPod(t *testing.T, isolate bool) v1.PodSpec {
	t.Helper()
	cfg := reverseTestConfig()
	if isolate {
		cfg.SyncFastShutdownIDs = "*"
	}
	pod := buildSyncPodTemplate(cfg, PodCtx{TaskType: "read", Inline: &InlinePayload{Package: "airbyte/source-x", Version: "1"}}, "config")
	return pod.Spec
}

func container(t *testing.T, spec v1.PodSpec, name string) v1.Container {
	t.Helper()
	for _, c := range spec.Containers {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no container %q", name)
	return v1.Container{}
}

func envValue(c v1.Container, name string) (string, bool) {
	for _, e := range c.Env {
		if e.Name == name {
			return e.Value, true
		}
	}
	return "", false
}

func TestPodIsolatesProcessesByDefault(t *testing.T) {
	spec := isolationPod(t, false)
	if spec.ShareProcessNamespace == nil || *spec.ShareProcessNamespace {
		t.Fatal("isolation must always be enabled")
	}
	if _, ok := envValue(container(t, spec, "sidecar"), "TERMINATE_SENTINEL"); ok {
		t.Fatal("sidecar must not get the sentinel when fast shutdown is disabled")
	}
	if strings.Contains(strings.Join(container(t, spec, "source").Command, " "), terminateSentinel) {
		t.Fatal("source command must be unchanged by default")
	}
}

func TestPodFastShutdownKeepsIsolation(t *testing.T) {
	spec := isolationPod(t, true)
	if spec.ShareProcessNamespace == nil || *spec.ShareProcessNamespace {
		t.Fatal("containers must not share a process namespace")
	}
	if v, ok := envValue(container(t, spec, "sidecar"), "TERMINATE_SENTINEL"); !ok || v != terminateSentinel {
		t.Fatalf("sidecar needs TERMINATE_SENTINEL=%s, got %q", terminateSentinel, v)
	}
	command := strings.Join(container(t, spec, "source").Command, " ")
	if !strings.Contains(command, terminateSentinel) || !strings.Contains(command, "$AIRBYTE_ENTRYPOINT read") {
		t.Fatalf("source command must watch the sentinel and still run the connector: %s", command)
	}
}

// k8sExpand mimics how Kubernetes treats container commands for text without $(VAR) references: "$$" is one dollar.
func k8sExpand(command string) string {
	return strings.ReplaceAll(command, "$$", "$")
}

func TestIsolatedSourceCommandSurvivesKubernetesExpansion(t *testing.T) {
	spec := isolationPod(t, true)
	command := container(t, spec, "source").Command[2]
	want := terminableCommand(buildSourceCommandForTest(), terminateSentinel)
	if got := k8sExpand(command); got != want {
		t.Fatalf("Kubernetes would hand the shell a different script.\nwant:\n%s\ngot:\n%s", want, got)
	}
	if !strings.Contains(k8sExpand(command), "kill -USR1 $$ ") {
		t.Fatal("the watcher must still kill the wrapper's own pid")
	}
}

func buildSourceCommandForTest() string {
	pc := PodCtx{TaskType: "read", Inline: &InlinePayload{Package: "airbyte/source-x", Version: "1"}}
	return strings.Replace(pc.sourceCommand(), `eval "`, `eval "exec `, 1)
}

func TestK8sEscape(t *testing.T) {
	for in, want := range map[string]string{
		"kill -USR1 $$ )":  "kill -USR1 $$$$ )",
		"echo $(date)":     "echo $$(date)",
		"echo $$(x)":       "echo $$$$(x)",
		"echo $VAR ${VAR}": "echo $VAR ${VAR}",
		"wait $pid; $?":    "wait $pid; $?",
		"$$$":              "$$$$$",
	} {
		if got := k8sEscape(in); got != want {
			t.Errorf("k8sEscape(%q) = %q, want %q", in, got, want)
		}
		if back := k8sExpand(k8sEscape(in)); strings.Contains(in, "$(") == false && back != in {
			t.Errorf("round trip of %q gave %q", in, back)
		}
	}
}

func runWrapped(t *testing.T, connector string, afterMs time.Duration, createSentinel bool) (int, time.Duration) {
	t.Helper()
	sentinel := filepath.Join(t.TempDir(), "terminate")
	cmd := exec.Command("sh", "-c", terminableCommand(connector, sentinel))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	start := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) })
	if createSentinel {
		time.Sleep(afterMs)
		if err := os.WriteFile(sentinel, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		code := 0
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
		} else if err != nil {
			t.Fatal(err)
		}
		return code, time.Since(start)
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("wrapped command did not finish")
		return -1, 0
	}
}

func TestTerminableCommandPassesExitCodeThrough(t *testing.T) {
	for _, want := range []int{0, 3} {
		code, took := runWrapped(t, "exit "+string(rune('0'+want)), 0, false)
		if code != want {
			t.Errorf("connector exit %d came out as %d", want, code)
		}
		if took > 4*time.Second {
			t.Errorf("a finished connector must not wait for the watcher, took %v", took)
		}
	}
}

func TestTerminableCommandStopsWhenSentinelAppears(t *testing.T) {
	code, took := runWrapped(t, "sleep 8", 500*time.Millisecond, true)
	if code != 143 {
		t.Errorf("expected exit 143 after the sentinel, got %d", code)
	}
	if took > 5*time.Second {
		t.Errorf("the container must stop promptly after the sentinel, took %v", took)
	}
}

func TestFastShutdownSelection(t *testing.T) {
	cfg := &Config{SyncFastShutdownIDs: " canary, second, "}
	for _, id := range []string{"", "canary-prefix", "other"} {
		if cfg.syncFastShutdownEnabled(id) {
			t.Fatalf("unexpected selection %q", id)
		}
	}
	for _, id := range []string{"canary", "second"} {
		if !cfg.syncFastShutdownEnabled(id) {
			t.Fatalf("missing selection %q", id)
		}
	}
	cfg.SyncFastShutdownIDs = "*"
	if !cfg.syncFastShutdownEnabled("") {
		t.Fatal("wildcard must include inline tasks")
	}
	cfg.SyncFastShutdownIDs = "canary"
	pod := buildSyncPodTemplate(cfg, PodCtx{TaskType: "read", Entry: &SyncEntry{ID: "canary"}}, "config")
	if !strings.Contains(container(t, pod.Spec, "source").Command[2], terminateSentinel) {
		t.Fatal("entry ID was ignored")
	}
}

func TestWrapperForwardsNormalTerminationAndWaits(t *testing.T) {
	dir := t.TempDir()
	connector := filepath.Join(dir, "connector.sh")
	script := "trap 'sleep 1; touch " + dir + "/flushed; exit 0' TERM\ntouch " + dir + "/ready\nwhile :; do sleep 0.1; done\n"
	if err := os.WriteFile(connector, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", "-c", terminableCommand("exec sh "+connector, filepath.Join(dir, "terminate")))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) })
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, "ready")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("connector not ready")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) || exitErr.ExitCode() != 143 {
			t.Fatalf("unexpected termination: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("wrapper did not terminate")
	}
	if _, err := os.Stat(filepath.Join(dir, "flushed")); err != nil {
		t.Fatal("wrapper exited before connector cleanup")
	}
}
