"""Offline tests of ensure_secrets in dev-deploy.sh with a stub kubectl; never accesses a cluster."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "dev-deploy.sh"
# A stub kubectl that keeps the secret as files and the deployments as a list, and records every call.
STUB = r'''#!/usr/bin/env python3
import base64
import json
import os
from pathlib import Path
import sys

root = Path(os.environ["SECRETS_TEST_ROOT"])
name = Path(sys.argv[0]).name
args = sys.argv[1:]
secret = root / "secret"

def record():
    with (root / "calls").open("a") as out:
        out.write(json.dumps([name] + args) + "\n")

record()
if name == "minikube":
    print("Running")
    sys.exit(0)
if args[:2] == ["config", "current-context"]:
    print("minikube")
    sys.exit(0)
if args[:2] == ["get", "namespace"]:
    sys.exit(0)
if args[:3] == ["get", "secret", "jitsu-secrets"]:
    if not secret.exists():
        sys.exit(1)
    for i, a in enumerate(args):
        if a == "-o" and args[i + 1].startswith("jsonpath="):
            key = args[i + 1].split("{.data.")[1].rstrip("}")
            file = secret / key
            if file.exists():
                print(base64.b64encode(file.read_bytes()).decode(), end="")
    sys.exit(0)
if args[:3] == ["create", "secret", "generic"]:
    literals = {}
    for a in args:
        if a.startswith("--from-literal="):
            k, v = a[len("--from-literal="):].split("=", 1)
            literals[k] = v
    if "--dry-run=client" in args:
        print(json.dumps({"data": {k: base64.b64encode(v.encode()).decode() for k, v in literals.items()}}))
    else:
        secret.mkdir(exist_ok=True)
        for k, v in literals.items():
            (secret / k).write_text(v)
    sys.exit(0)
if args[:2] == ["patch", "secret"]:
    patch = json.loads(sys.stdin.read())
    secret.mkdir(exist_ok=True)
    for k, v in patch["data"].items():
        (secret / k).write_bytes(base64.b64decode(v))
    sys.exit(0)
if args[:2] == ["get", "deployment"]:
    existing = (root / "deployments").read_text().split() if (root / "deployments").exists() else []
    sys.exit(0 if args[2] in existing else 1)
sys.exit(0)
'''


class EnsureSecretsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="jitsu-secrets-test-")
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for tool in ("kubectl", "minikube"):
            path = self.bin / tool
            path.write_text(STUB)
            path.chmod(0o755)
        self.addCleanup(self.temp.cleanup)

    def secret_file(self, key, value=None):
        directory = self.root / "secret"
        directory.mkdir(exist_ok=True)
        if value is not None:
            (directory / key).write_text(value)
        return directory / key

    def run_secrets(self, deployments=("rotor", "profiles")):
        (self.root / "deployments").write_text("\n".join(deployments))
        (self.root / "calls").write_text("")
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", SECRETS_TEST_ROOT=str(self.root), NAMESPACE="test")
        result = subprocess.run(["bash", str(SCRIPT), "secrets"], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = [json.loads(line) for line in (self.root / "calls").read_text().splitlines()]
        return [c[3].split("/")[1] for c in calls if c[1:3] == ["rollout", "restart"]]

    def value(self, key):
        return (self.root / "secret" / key).read_text()

    def test_fresh_install_seeds_rotor_token_without_restart(self):
        restarted = self.run_secrets()
        self.assertEqual(restarted, [])
        self.assertTrue(self.value("RAW_AUTH_TOKENS"))
        self.assertEqual(self.value("ROTOR_RAW_AUTH_TOKENS"), self.value("RAW_AUTH_TOKENS"))
        self.assertEqual(self.value("ROTOR_AUTH_KEY"), self.value("RAW_AUTH_TOKENS"))

    def test_existing_install_without_the_key_is_seeded_and_rotor_and_profiles_restart(self):
        self.secret_file("RAW_AUTH_TOKENS", "existing-token")
        restarted = self.run_secrets()
        self.assertEqual(self.value("ROTOR_RAW_AUTH_TOKENS"), "existing-token")
        self.assertEqual(sorted(restarted), ["profiles", "rotor"])

    def test_only_deployments_that_exist_restart(self):
        self.secret_file("RAW_AUTH_TOKENS", "existing-token")
        self.assertEqual(self.run_secrets(deployments=("rotor",)), ["rotor"])

    def test_empty_key_counts_as_missing(self):
        self.secret_file("RAW_AUTH_TOKENS", "existing-token")
        self.secret_file("ROTOR_RAW_AUTH_TOKENS", "")
        restarted = self.run_secrets()
        self.assertEqual(self.value("ROTOR_RAW_AUTH_TOKENS"), "existing-token")
        self.assertEqual(sorted(restarted), ["profiles", "rotor"])

    def test_provisioned_rotor_token_is_preserved_and_nothing_restarts(self):
        self.secret_file("RAW_AUTH_TOKENS", "existing-token")
        self.secret_file("ROTOR_RAW_AUTH_TOKENS", "own-rotor-token")
        restarted = self.run_secrets()
        self.assertEqual(self.value("ROTOR_RAW_AUTH_TOKENS"), "own-rotor-token")
        self.assertEqual(restarted, [])

    def test_second_run_does_not_restart_again(self):
        self.secret_file("RAW_AUTH_TOKENS", "existing-token")
        self.assertEqual(sorted(self.run_secrets()), ["profiles", "rotor"])
        self.assertEqual(self.run_secrets(), [])


if __name__ == "__main__":
    unittest.main()
