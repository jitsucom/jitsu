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
if name == "kubectl" and (root / "fail-forward").exists():
    (root / "fail-forward").unlink()
    record("disconnect")
    sys.exit(1)
while True:
    if name == "minikube" and (root / "exit-tunnel").exists():
        record("exit")
        sys.exit(int((root / "exit-tunnel").read_text()))
    time.sleep(0.02)
'''


class DevTunnelTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="jitsu-tunnel-test-")
        self.root = Path(self.temp.name)
        for name in ["kubectl", "minikube"]:
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

    def start(self):
        self.proc = subprocess.Popen(
            ["/bin/bash", str(SCRIPT), "tunnel"],
            env={**os.environ, "PATH": f"{self.root}:{os.environ['PATH']}",
                 "NAMESPACE": "test-namespace", "TUNNEL_TEST_ROOT": str(self.root)},
            stdin=subprocess.DEVNULL, stdout=self.output, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.wait_for(lambda events: {e["name"] for e in events if e["event"] == "start"}
                      == {"kubectl", "minikube"})

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
        self.wait_for(lambda events: any(e["event"] == "disconnect" for e in events))
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=5), 143)
        self.assert_children_stopped()

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
