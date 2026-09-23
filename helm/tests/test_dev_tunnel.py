"""Offline tunnel lifecycle tests using stub commands; never accesses a cluster."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "dev-deploy.sh"
STUB = r'''
import json
import os
from pathlib import Path
import signal
import sys
import time

name = Path(sys.argv[0]).name
root = Path(os.environ["TUNNEL_TEST_ROOT"])
if name == "kubectl" and sys.argv[1:] == ["config", "current-context"]:
    print("minikube")
    sys.exit(0)

def record(event):
    with (root / "events").open("a") as out:
        out.write(json.dumps({"name": name, "event": event, "pid": os.getpid(), "args": sys.argv[1:]}) + "\n")

def stop(signum, frame):
    record("stop")
    sys.exit(0)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
record("start")
if name == "kubectl":
    (root / "forward-started").touch()
deadline = time.monotonic() + (float(sys.argv[1]) if name == "sleep" else 0)
if name == "kubectl" and (root / "fail-forward").exists():
    (root / "fail-forward").unlink()
    record("disconnect")
    sys.exit(1)
while True:
    if name == "sleep" and time.monotonic() >= deadline:
        record("exit")
        sys.exit(0)
    if name == "minikube" and (root / "exit-tunnel").exists():
        record("exit")
        sys.exit(int((root / "exit-tunnel").read_text()))
    time.sleep(0.02)
'''


class DevTunnelTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="jitsu-tunnel-test-")
        self.root = Path(self.temp.name)
        for name in ["kubectl", "minikube", "sleep"]:
            command = self.root / name
            command.write_text(f"#!{sys.executable}\n" + STUB)
            command.chmod(0o755)
        self.proc = None
        self.output = (self.root / "output").open("w+")

    def tearDown(self):
        if self.proc:
            # Test-owned process group only: also clean up children after a failed assertion.
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.proc.wait(timeout=5)
        self.output.close()
        self.temp.cleanup()

    def events(self):
        path = self.root / "events"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def wait_for(self, predicate):
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            if predicate(self.events()):
                return
            time.sleep(0.02)
        self.fail(f"Timed out waiting for tunnel events: {self.events()}")

    def start(self, bash_env=None):
        self.proc = subprocess.Popen(
            ["/bin/bash", str(SCRIPT), "tunnel"],
            env={**os.environ, "PATH": f"{self.root}:{os.environ['PATH']}",
                 "NAMESPACE": "test-namespace", "TUNNEL_TEST_ROOT": str(self.root),
                 **({"BASH_ENV": str(bash_env)} if bash_env else {})},
            stdin=subprocess.DEVNULL, stdout=self.output, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.wait_for(lambda events: {e["name"] for e in events if e["event"] == "start"}
                      >= {"kubectl", "minikube"})

    def assert_children_stopped(self):
        starts = {e["pid"] for e in self.events() if e["event"] == "start"}
        stops = {e["pid"] for e in self.events() if e["event"] in ["stop", "exit", "disconnect"]}
        self.assertEqual(starts, stops)
        for pid in starts:
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        # The supervisor and any retry sleep must also be gone.
        with self.assertRaises(ProcessLookupError):
            os.killpg(self.proc.pid, 0)

    def test_loopback_namespace_and_sigterm_cleanup(self):
        self.start()
        forward = next(e for e in self.events() if e["name"] == "kubectl")
        self.assertEqual(forward["args"], ["--context", "minikube", "-n", "test-namespace",
                                          "port-forward", "--address", "127.0.0.1",
                                          "service/syncctl", "3043:3043"])
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=5), 143)
        self.assert_children_stopped()

    def test_ctrl_c_cleanup(self):
        self.start()
        os.killpg(self.proc.pid, signal.SIGINT)
        self.assertEqual(self.proc.wait(timeout=5), 130)
        self.assert_children_stopped()

    def test_tunnel_exit_cleans_up_forward_and_preserves_exit_code(self):
        self.start()
        (self.root / "exit-tunnel").write_text("7")
        self.assertEqual(self.proc.wait(timeout=5), 7)
        self.assert_children_stopped()

    def test_successful_tunnel_exit_cleans_up_forward(self):
        self.start()
        (self.root / "exit-tunnel").write_text("0")
        self.assertEqual(self.proc.wait(timeout=5), 0)
        self.assert_children_stopped()

    def test_stops_during_reconnect_delay(self):
        (self.root / "fail-forward").touch()
        self.start()
        # Wait for the retry delay itself, not the disconnect marker written
        # before kubectl has actually exited and been reaped.
        self.wait_for(lambda events: any(e["name"] == "sleep" and e["event"] == "start" for e in events))
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=5), 143)
        self.assert_children_stopped()

    def test_stops_while_disconnected_forward_is_exiting(self):
        (self.root / "fail-forward").touch()
        self.start()
        self.wait_for(lambda events: any(e["event"] == "disconnect" for e in events))
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=5), 143)
        self.assert_children_stopped()

    def signal_before(self, command):
        # Force the narrow shutdown window instead of relying on CI scheduling.
        # sh's PPID identifies the supervisor even on macOS Bash 3 (no BASHPID).
        hook = self.root / "bash-env"
        hook.write_text(r'''
set -T
trap 'if [[ "${FUNCNAME[0]:-}" == forward_syncctl && "$BASH_COMMAND" == __COMMAND__ ]]; then
    while [[ ! -f "$TUNNEL_TEST_ROOT/forward-started" ]]; do :; done
    kill -TERM "$(exec sh -c '\''echo "$PPID"'\'')"
fi' DEBUG
'''.replace("__COMMAND__", command))
        self.start(hook)
        # The injected signal alone must stop the worker. Stopping the parent
        # first would send a second TERM and conceal the pre-wait race.
        self.wait_for(lambda events: any(e["name"] == "kubectl" and e["event"] == "stop" for e in events))
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=5), 143)
        self.assert_children_stopped()

    def test_signal_between_child_launch_and_pid_capture(self):
        self.signal_before(r'"child_pid=\$!"')

    def test_signal_immediately_before_wait(self):
        self.signal_before(r'"wait \"\$child_pid\""')

    def test_reconnects_after_forward_disconnects(self):
        (self.root / "fail-forward").touch()
        self.start()
        self.wait_for(lambda events: sum(e["name"] == "kubectl" and e["event"] == "start"
                                         for e in events) == 2)
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=5), 143)
        self.assert_children_stopped()


if __name__ == "__main__":
    unittest.main()
