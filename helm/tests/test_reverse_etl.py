"""Offline chart contract tests: python3 -m unittest discover -s helm/tests -v.

Requires Helm on PATH and PyYAML. Never connects to a cluster.
"""
import json
from pathlib import Path
import subprocess
import unittest

import yaml

CHART = Path(__file__).resolve().parents[1]


def render(values):
    return subprocess.run(
        ["helm", "template", "test", str(CHART), "--namespace", "retl-test",
         "--set", "projectRoot=/tmp/jitsu", "-f", "-"],
        input=yaml.safe_dump(values), text=True, capture_output=True, check=False,
    )


def enabled(**overrides):
    return {"reverseEtl": {
        "enabled": True, "runnerImage": "retl:test", "runtimeSecret": "retl-runtime",
        **overrides,
    }}


class ReverseEtlChartTest(unittest.TestCase):
    def manifests(self, values):
        result = render(values)
        self.assertEqual(result.returncode, 0, result.stderr)
        return {(doc["kind"], doc["metadata"]["name"]): doc
                for doc in yaml.safe_load_all(result.stdout) if doc}

    def controller_env(self, docs):
        env = docs[("Deployment", "syncctl")]["spec"]["template"]["spec"]["containers"][0]["env"]
        self.assertEqual(len(env), len({item["name"] for item in env}))
        return {item["name"]: item.get("value") for item in env}

    def test_disabled_by_default(self):
        docs = self.manifests({})
        self.assertEqual(self.controller_env(docs)["SYNCCTL_REVERSE_ENABLED"], "false")
        self.assertNotIn(("ServiceAccount", "test-retl-runner"), docs)
        self.assertNotIn(("RoleBinding", "test-retl-runner"), docs)

    def test_controller_override_is_preserved_when_restacked(self):
        docs = self.manifests({**enabled(controllerSecret="retl-controller"),
                               "syncctlProjectRoot": "/tmp/retl-worktree"})
        controller = docs[("Deployment", "syncctl")]["spec"]["template"]["spec"]
        self.assertEqual(controller["containers"][0]["envFrom"][-1],
                         {"secretRef": {"name": "retl-controller"}})
        project = next(volume for volume in controller["volumes"] if volume["name"] == "project")
        self.assertEqual(project["hostPath"]["path"], "/tmp/retl-worktree")
        for (kind, name), doc in docs.items():
            if kind == "Deployment" and name != "syncctl":
                for container in doc["spec"]["template"]["spec"]["containers"]:
                    self.assertNotIn({"secretRef": {"name": "retl-controller"}}, container.get("envFrom", []))

    def test_syncctl_is_exposed_for_minikube_tunnel(self):
        docs = self.manifests({})
        service = docs[("Service", "syncctl")]["spec"]
        self.assertEqual(service["type"], "LoadBalancer")
        http = next(port for port in service["ports"] if port["name"] == "http")
        self.assertEqual(http["port"], 3043)
        self.assertEqual(http["targetPort"], "http")

    def test_enabled_resources_and_identity(self):
        annotations = {"iam.gke.io/gcp-service-account": "runner@example.iam.gserviceaccount.com"}
        docs = self.manifests(enabled(serviceAccount={"annotations": annotations},
                                      resources={"limits": {"ephemeral-storage": "8Gi"}},
                                      scratchSizeLimit="6Gi"))
        env = self.controller_env(docs)
        self.assertEqual(env["SYNCCTL_REVERSE_ENABLED"], "true")
        self.assertEqual(env["SYNCCTL_REVERSE_RUNNER_IMAGE"], "retl:test")
        self.assertEqual(env["SYNCCTL_REVERSE_RUNTIME_SECRET"], "retl-runtime")
        self.assertEqual(env["SYNCCTL_REVERSE_SERVICE_ACCOUNT"], "test-retl-runner")
        self.assertEqual(env["SYNCCTL_REVERSE_SCRATCH_SIZE_LIMIT"], "6Gi")
        resources = json.loads(env["SYNCCTL_REVERSE_RUNNER_RESOURCES"])
        self.assertEqual(resources["limits"]["ephemeral-storage"], "8Gi")
        self.assertEqual(resources["requests"]["memory"], "256Mi")
        self.assertEqual(docs[("ServiceAccount", "test-retl-runner")]["metadata"]["annotations"], annotations)
        self.assertNotIn("annotations", docs[("ServiceAccount", "sync-pod")]["metadata"])
        self.assertEqual(docs[("Role", "test-retl-runner")]["rules"], [{
            "apiGroups": ["coordination.k8s.io"], "resources": ["leases"],
            "verbs": ["get", "create", "update", "delete"],
        }])
        self.assertEqual(docs[("RoleBinding", "test-retl-runner")]["subjects"], [{
            "kind": "ServiceAccount", "name": "test-retl-runner", "namespace": "retl-test",
        }])
        # The runtime Secret is referenced by name; credentials never enter Helm values/manifests.
        self.assertNotIn(("Secret", "retl-runtime"), docs)

    def test_external_service_account(self):
        docs = self.manifests(enabled(serviceAccount={"create": False, "name": "external-runner"}))
        self.assertNotIn(("ServiceAccount", "external-runner"), docs)
        self.assertEqual(self.controller_env(docs)["SYNCCTL_REVERSE_SERVICE_ACCOUNT"], "external-runner")
        self.assertEqual(docs[("RoleBinding", "test-retl-runner")]["subjects"][0]["name"], "external-runner")

    def test_eks_annotation(self):
        annotations = {"eks.amazonaws.com/role-arn": "arn:aws:iam::123456789012:role/retl"}
        docs = self.manifests(enabled(serviceAccount={"name": "aws-runner", "annotations": annotations}))
        self.assertEqual(docs[("ServiceAccount", "aws-runner")]["metadata"]["annotations"], annotations)

    def test_invalid_settings_fail_render(self):
        for values, message in [
            (enabled(runnerImage=""), "runnerImage is required"),
            (enabled(runtimeSecret=""), "runtimeSecret is required"),
            (enabled(serviceAccount={"create": False}), "name is required"),
            (enabled(serviceAccount={"create": False, "name": "existing", "annotations": {"foo": "bar"}}), "annotate the existing"),
            (enabled(serviceAccount={"name": "sync-pod"}), "dedicated service account"),
            ({**enabled(), "scaling": {"syncctl": {"replicas": 0}}}, "requires scaling.syncctl"),
            (enabled(enabled="true"), "boolean"),
            (enabled(scratchSizeLimit="many"), "scratchSizeLimit"),
            (enabled(resources={"limits": {"gpu": "1"}}), "gpu"),
            (enabled(serviceAccount={"annotations": {"foo": True}}), "string"),
        ]:
            with self.subTest(values=values):
                result = render(values)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)

    def test_env_overrides_cannot_bypass_validation(self):
        for scope in ["common", "syncctl"]:
            for prefix in ["", "SYNCCTL_"]:
                result = render({"env": {scope: {prefix + "REVERSE_ENABLED": True}}})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("via reverseEtl", result.stderr)

    def test_schema_hook_never_accepts_data_loss(self):
        docs = self.manifests({})
        hooks = [doc for (kind, _), doc in docs.items() if kind == "Job"]
        commands = "\n".join(" ".join(container["command"])
                             for job in hooks for container in job["spec"]["template"]["spec"]["containers"])
        self.assertIn("prisma db push", commands)
        self.assertNotIn("--accept-data-loss", commands)


if __name__ == "__main__":
    unittest.main()
