# MinIO test image

The file-storage tests build `Dockerfile.minio` automatically using the local
Docker daemon. No registry credentials or manual setup are required. The first
run downloads and compiles MinIO; later runs reuse Docker's build cache. Fresh
CI runners pay the build cost once per app shard.

The Dockerfile pins MinIO's `RELEASE.2025-09-07T16-13-09Z` source commit, verifies
the source archive's SHA-256, and pins multi-platform base image digests. It
builds natively on Linux amd64 (CI) and arm64 (Apple Silicon Docker).

This image is only for tests, not a supported production MinIO distribution.
To build it manually from this directory:

```sh
docker build -f Dockerfile.minio -t jitsu-minio-test .
```
