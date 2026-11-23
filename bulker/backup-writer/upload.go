package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"hash/crc32"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/storage"
	"google.golang.org/api/googleapi"
)

type uploadObject func(ctx context.Context, workspace, name string, data []byte) error

func gcsUploader(client *storage.Client, prefix string) uploadObject {
	return func(ctx context.Context, workspace, name string, data []byte) error {
		var compressed bytes.Buffer
		gz := gzip.NewWriter(&compressed)
		if _, err := gz.Write(data); err != nil {
			return err
		}
		if err := gz.Close(); err != nil {
			return err
		}
		checksum := crc32.Checksum(compressed.Bytes(), crc32.MakeTable(crc32.Castagnoli))
		digest := fmt.Sprintf("%x", sha256.Sum256(data))
		obj := client.Bucket(prefix + workspace).Object(name)
		writeCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		w := obj.If(storage.Conditions{DoesNotExist: true}).NewWriter(writeCtx)
		w.ContentType = "application/gzip"
		w.Metadata = map[string]string{"ndjson-sha256": digest}
		w.CRC32C = checksum
		w.SendCRC32C = true
		_, err := w.Write(compressed.Bytes())
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
		// checkpoint. Verify the actual object before reclaiming local data.
		a, err := obj.Attrs(ctx)
		if err != nil {
			return err
		}
		if a.Metadata["ndjson-sha256"] != digest || a.CRC32C != checksum || a.Size != int64(compressed.Len()) {
			return fmt.Errorf("existing object %s has different content", name)
		}
		return nil
	}
}

func drain(ctx context.Context, s *spool, upload uploadObject) error {
	entries, err := s.rotate()
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
		name = strings.TrimSuffix(name, ".ndjson.gz") + fmt.Sprintf("_prefix_%x.ndjson.gz", sha256.Sum256(data))
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
