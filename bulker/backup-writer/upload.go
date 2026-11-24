package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/storage"
	"github.com/klauspost/compress/zstd"
	"google.golang.org/api/googleapi"
)

type uploadObject func(ctx context.Context, workspace, name string, data []byte) error

func newGCSUploader(client *storage.Client, prefix string) (uploadObject, error) {
	// Match the S3/GCS archive preset in bulkerlib/types/compression.go.
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedBetterCompression), zstd.WithEncoderConcurrency(1))
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context, workspace, name string, data []byte) error {
		var compressed []byte
		var contentType string
		switch {
		case strings.HasSuffix(name, ".ndjson.zst"):
			compressed = encoder.EncodeAll(data, nil)
			contentType = "application/zstd"
		case strings.HasSuffix(name, ".ndjson.gz"):
			var buf bytes.Buffer
			gz := gzip.NewWriter(&buf)
			if _, err := gz.Write(data); err != nil {
				return err
			}
			if err := gz.Close(); err != nil {
				return err
			}
			compressed = buf.Bytes()
			contentType = "application/gzip"
		default:
			return fmt.Errorf("unsupported archive suffix: %q", name)
		}
		checksum := crc32.Checksum(compressed, crcTable)
		digest := fmt.Sprintf("%x", sha256.Sum256(data))
		obj := client.Bucket(prefix + workspace).Object(name)
		writeCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		w := obj.If(storage.Conditions{DoesNotExist: true}).NewWriter(writeCtx)
		w.ContentType = contentType
		w.Metadata = map[string]string{"ndjson-sha256": digest}
		w.CRC32C = checksum
		w.SendCRC32C = true
		_, err := w.Write(compressed)
		if err != nil {
			cancel()
			_ = w.Close()
		} else {
			err = w.Close()
		}
		if err == nil {
			return nil
		}
		var apiErr *googleapi.Error
		if !errors.As(err, &apiErr) || apiErr.Code != 412 {
			return err
		}
		// The previous attempt may have committed remotely before we could
		// checkpoint. The writer records this plaintext digest on its checksum-validated
		// upload. Another encoder version may compress the same bytes differently.
		a, err := obj.Attrs(ctx)
		if err != nil {
			return err
		}
		if a.Metadata["ndjson-sha256"] != digest {
			return fmt.Errorf("existing object %s has different content", name)
		}
		if a.CRC32C == checksum && a.Size == int64(len(compressed)) {
			return nil
		}
		// A different encoder can produce different bytes for the same NDJSON.
		// Read the live object only if its generation still matches the metadata.
		stored, err := obj.If(storage.Conditions{GenerationMatch: a.Generation}).ReadCompressed(true).NewReader(ctx)
		if err != nil {
			return err
		}
		defer stored.Close()
		return verifyArchive(stored, contentType, len(data), digest)
	}, nil
}

func verifyArchive(stored io.Reader, contentType string, size int, digest string) error {
	var decoded io.Reader
	if contentType == "application/zstd" {
		zr, err := zstd.NewReader(stored, zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxMemory(2*segmentSize))
		if err != nil {
			return err
		}
		defer zr.Close()
		decoded = zr
	} else {
		gz, err := gzip.NewReader(stored)
		if err != nil {
			return err
		}
		defer gz.Close()
		decoded = gz
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(decoded, int64(size)+1))
	if err != nil {
		return err
	}
	if n != int64(size) || fmt.Sprintf("%x", hash.Sum(nil)) != digest {
		return errors.New("existing archive has different uncompressed content")
	}
	return nil
}

func drain(ctx context.Context, s *spool, upload uploadObject) error {
	entries, err := s.pending()
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err = ctx.Err(); err != nil {
			return err
		}
		if strings.HasPrefix(entry.Name(), ".destination-") || strings.HasSuffix(entry.Name(), ".damaged") {
			continue
		}
		if err := uploadSegment(ctx, s, entry, upload); err != nil {
			log.Printf("archive segment %q: %v", entry.Name(), err)
		}
	}
	return nil
}

func uploadSegment(ctx context.Context, s *spool, entry os.DirEntry, upload uploadObject) error {
	if !entry.Type().IsRegular() {
		return errors.New("unexpected non-regular spool entry")
	}
	workspace, name, err := segmentObject(entry.Name())
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir.Name(), entry.Name())
	data, err := readSegment(path)
	damaged := errors.Is(err, errDamagedFrame)
	if err != nil && !damaged {
		return err
	}
	if damaged {
		// Preserve acknowledged frames preceding a damaged append. A separate
		// deterministic key cannot conflict with an earlier full-object upload.
		log.Printf("damaged segment %q, verified prefix %d bytes: %v", entry.Name(), len(data), err)
		stem, suffix, _ := strings.Cut(name, ".ndjson.")
		name = fmt.Sprintf("%s_prefix_%x.ndjson.%s", stem, sha256.Sum256(data), suffix)
	}
	if len(data) > 0 {
		uploadCtx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		if err = upload(uploadCtx, workspace, name, data); err != nil {
			return err
		}
	}
	if damaged {
		err = os.Rename(path, path+".damaged")
	} else {
		err = os.Remove(path)
	}
	if err != nil {
		return err
	}
	return s.dir.Sync()
}
