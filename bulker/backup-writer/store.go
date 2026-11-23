package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
)

const maxRequestSize = 8 << 20
const segmentSize = 8 << 20
const spoolHeadroom = 256 << 20
const frameHeaderSize = 12
const segmentTime = "2006_01_02T15_04_05"

var errDamagedFrame = errors.New("damaged archive frame")

var crcTable = crc32.MakeTable(crc32.Castagnoli)

type segment struct {
	name string
	size int
}

type spool struct {
	prefix string
	dir    *os.File
	mu     sync.Mutex
	active map[string]segment // only files in this map can still be appended to
}

var bucketCharacters = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*[a-z0-9]$`)
var reservedBucketName = regexp.MustCompile(`^goog|g[o0][o0]gle`)

func validBucketName(name string) bool {
	if len(name) < 3 || len(name) > 222 || !bucketCharacters.MatchString(name) ||
		reservedBucketName.MatchString(name) || net.ParseIP(name) != nil {
		return false
	}
	for part := range strings.SplitSeq(name, ".") {
		if len(part) == 0 || len(part) > 63 {
			return false
		}
	}
	return true
}

// Use an existing dedicated directory on the persistent volume. Flocking the
// directory prevents a second writer from uploading a file still being appended.
func openSpool(path, prefix string) (*spool, error) {
	// Test a shortest legal completion before permanently binding the spool.
	if prefix == "" || !validBucketName(prefix+strings.Repeat("x", max(1, 3-len(prefix)))) {
		return nil, errors.New("invalid backup bucket prefix")
	}
	dir, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	if err = initializeDir(dir, prefix); err != nil {
		dir.Close()
		return nil, err
	}
	return &spool{prefix: prefix, dir: dir, active: make(map[string]segment)}, nil
}

func initializeDir(dir *os.File, prefix string) error {
	if err := syscall.Flock(int(dir.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("lock spool: %w", err)
	}
	// The marker's name binds pending segments to their configured destination.
	// Creating a single directory entry avoids partially written marker data.
	marker := ".destination-" + base64.RawURLEncoding.EncodeToString([]byte(prefix))
	path := filepath.Join(dir.Name(), marker)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		entries, err := dir.ReadDir(1)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		if len(entries) > 0 {
			return errors.New("spool is not empty and has no matching bucket prefix marker")
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		if err = f.Close(); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	return dir.Sync()
}

func (s *spool) close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active = nil
	return s.dir.Close()
}

func (s *spool) append(workspace string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return os.ErrClosed
	}
	var fs syscall.Statfs_t
	if err := syscall.Fstatfs(int(s.dir.Fd()), &fs); err != nil {
		return err
	}
	if uint64(fs.Bavail)*uint64(fs.Bsize) < spoolHeadroom+uint64(len(data)) {
		return errors.New("archive spool below free-space reserve")
	}

	seg := s.active[workspace]
	fresh := seg.name == "" || seg.size+frameHeaderSize+len(data) > segmentSize
	flags := os.O_APPEND | os.O_WRONLY
	if fresh {
		seg = segment{name: workspace + "." + time.Now().UTC().Format(segmentTime) + "_" + uuid.NewString() + ".zst.seg"}
		flags |= os.O_CREATE | os.O_EXCL
	}
	f, err := os.OpenFile(filepath.Join(s.dir.Name(), seg.name), flags, 0600)
	if err != nil {
		return err
	}
	// On a write or sync error retire this segment. A later submission must
	// never append behind a torn frame, including after a writer restart.
	delete(s.active, workspace)
	var header [frameHeaderSize]byte
	binary.BigEndian.PutUint32(header[:4], uint32(len(data)))
	binary.BigEndian.PutUint32(header[4:8], ^uint32(len(data)))
	binary.BigEndian.PutUint32(header[8:], crc32.Checksum(data, crcTable))
	if _, err = f.Write(header[:]); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err == nil && fresh {
		err = s.dir.Sync()
	}
	if err != nil {
		return err
	}
	seg.size += frameHeaderSize + len(data)
	s.active[workspace] = seg
	return nil
}

// A crash can leave an incomplete final request. Every acknowledged frame has
// a complete header and payload. Preserve the file for inspection on corruption.
func readSegment(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// A retired segment can also contain a complete but unacknowledged write.
	// Persist those bytes before publishing under the permanent object name.
	if err = f.Sync(); err != nil {
		return nil, err
	}
	reader := bufio.NewReaderSize(f, 64<<10)
	var out bytes.Buffer
	var header [frameHeaderSize]byte
	for {
		if _, err = io.ReadFull(reader, header[:]); errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		} else if err != nil {
			return nil, err
		}
		size := int(binary.BigEndian.Uint32(header[:4]))
		if binary.BigEndian.Uint32(header[4:8]) != ^uint32(size) || size == 0 || size > maxRequestSize+1 || out.Len()+size > segmentSize+1 {
			return out.Bytes(), fmt.Errorf("%w: invalid length", errDamagedFrame)
		}
		frame := make([]byte, size)
		if _, err = io.ReadFull(reader, frame); errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		} else if err != nil {
			return nil, err
		}
		if crc32.Checksum(frame, crcTable) != binary.BigEndian.Uint32(header[8:]) {
			return out.Bytes(), fmt.Errorf("%w: checksum mismatch", errDamagedFrame)
		}
		out.Write(frame)
	}
	return out.Bytes(), nil
}

func segmentObject(filename string) (workspace, name string, err error) {
	workspace, stem, ok := strings.Cut(filename, ".")
	stem, ext := strings.CutSuffix(stem, ".seg")
	// The codec is part of the segment identity. Older .seg files must retry
	// their original gzip key if a crash interrupted local cleanup.
	stem, isZstd := strings.CutSuffix(stem, ".zst")
	suffix := ".ndjson.gz"
	if isZstd {
		suffix = ".ndjson.zst"
	}
	if !ok || !ext || !workspaceID.MatchString(workspace) || len(stem) != len(segmentTime)+1+36 {
		return "", "", fmt.Errorf("unexpected segment %q", filename)
	}
	stamp := stem[:len(segmentTime)]
	t, err := time.Parse(segmentTime, stamp)
	if err != nil {
		return "", "", err
	}
	if stem[len(stamp)] != '_' {
		return "", "", fmt.Errorf("invalid segment %q", filename)
	}
	if _, err = uuid.Parse(stem[len(stamp)+1:]); err != nil {
		return "", "", err
	}
	return workspace, t.Format("2006-01-02") + "/backup_" + stem + suffix, nil
}

// Detach active segments even when the uploader is blocked in GCS.
func (s *spool) rotate() {
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.active)
}

// Take the directory snapshot under the append lock so a newly created segment
// cannot appear in it before its active entry is installed.
func (s *spool) pending() ([]os.DirEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return nil, os.ErrClosed
	}
	entries, err := os.ReadDir(s.dir.Name())
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(entries, func(entry os.DirEntry) bool {
		workspace, _, _ := strings.Cut(entry.Name(), ".")
		return s.active[workspace].name == entry.Name()
	}), nil
}
