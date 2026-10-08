package types

import (
	"fmt"
	"io"
	"sync"

	// Drop-in for compress/gzip: emits standard gzip, so the batch files the
	// warehouse COPY commands consume are unchanged in format.
	"github.com/jitsucom/bulker/jitsubase/compression"
	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
)

// Encoder lifecycle.
//
// The ticket asks for encoders reused "per destination rather than allocating per
// batch". Per-destination is not quite achievable: a Destination is shared across
// one topic consumer per table x mode (bulkerapp/app/repository.go), so several
// streams run against it concurrently, and zstd's streaming writer is not safe for
// concurrent use. Pinning one encoder to a destination would need a lock and would
// serialise batches that run in parallel today.
//
// A pool gets the same benefit - no allocation per batch - and is safe under the
// concurrency this code actually has. Only two encoder configurations exist, so
// two pools suffice. Same pattern as jitsubase/jsonorder, which pools its streams
// and iterators for the same reason.
//
// WithEncoderConcurrency(1) per the ticket: bulker already parallelises across
// destinations, and per-encoder workers would multiply that.

type zstdPool struct {
	pool sync.Pool
	opts []zstd.EOption
}

func newZstdPool(level zstd.EncoderLevel) *zstdPool {
	p := &zstdPool{
		opts: []zstd.EOption{
			zstd.WithEncoderLevel(level),
			zstd.WithEncoderConcurrency(1),
		},
	}
	p.pool.New = func() any {
		// A nil writer is the documented way to build an encoder for later Reset.
		enc, err := zstd.NewWriter(nil, p.opts...)
		if err != nil {
			return nil
		}
		return enc
	}
	return p
}

// get returns a writer encoding into w. Closing it returns the encoder to the pool.
func (p *zstdPool) get(w io.Writer) (*zstdWriter, error) {
	enc, _ := p.pool.Get().(*zstd.Encoder)
	if enc == nil {
		var err error
		enc, err = zstd.NewWriter(nil, p.opts...)
		if err != nil {
			return nil, fmt.Errorf("failed to create zstd encoder: %w", err)
		}
	}
	enc.Reset(w)
	return &zstdWriter{enc: enc, pool: p}, nil
}

// zstdWriter hands its encoder back to the pool on Close. It is single-use: after
// Close the encoder belongs to the pool again and must not be written to.
type zstdWriter struct {
	enc  *zstd.Encoder
	pool *zstdPool
}

func (z *zstdWriter) Write(p []byte) (int, error) {
	if z.enc == nil {
		return 0, fmt.Errorf("zstd writer already closed")
	}
	return z.enc.Write(p)
}

func (z *zstdWriter) Close() error {
	if z.enc == nil {
		return nil
	}
	err := z.enc.Close()
	// Drop the reference to the underlying writer before pooling, so a finished
	// batch file cannot be pinned by an idle encoder.
	z.enc.Reset(nil)
	z.pool.pool.Put(z.enc)
	z.enc = nil
	return err
}

var (
	// Objects live 90 days in S3/GCS and the event archive - size is worth the CPU,
	// and denser frames decode faster too.
	zstdArchive = newZstdPool(zstd.SpeedBetterCompression)

	// Failover logs and job payloads are write-once-read-once and then deleted.
	zstdInternal = newZstdPool(zstd.SpeedDefault)
)

// NewArchiveZstdWriter returns a SpeedBetterCompression zstd writer for objects
// that live in S3/GCS or the event archive. Close it to return the encoder to the
// pool.
func NewArchiveZstdWriter(w io.Writer) (io.WriteCloser, error) {
	return zstdArchive.get(w)
}

// NewInternalZstdWriter returns a SpeedDefault zstd writer for internal
// write-once-read-once files. Close it to return the encoder to the pool.
func NewInternalZstdWriter(w io.Writer) (io.WriteCloser, error) {
	return zstdInternal.get(w)
}

// wrapCompression wraps w for the given compression and returns the writer to use
// plus the closer that must be called on flush. The closer is nil when there is
// nothing to close.
//
// Marshaller output is only ever compressed for S3/GCS file destinations and the
// event archive, so zstd here always means the archive level.
func wrapCompression(compression FileCompression, w io.Writer) (io.Writer, io.Closer, error) {
	switch compression {
	case FileCompressionGZIP:
		gw, err := gzip.NewWriterLevel(w, gzipLevel)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to create gzip writer: %w", err)
		}
		return gw, gw, nil
	case FileCompressionZSTD:
		zw, err := zstdArchive.get(w)
		if err != nil {
			return nil, nil, err
		}
		return zw, zw, nil
	default:
		return w, nil, nil
	}
}

// CompressionExtension is the filename suffix for a compression, including the
// leading dot, or "" for none.
//
// Readers in this codebase pick a decompressor from the file name, so a file whose
// name does not carry its compression is not merely mislabelled - it is unreadable,
// or invisible to the extension filters that discover it. Every place that builds a
// name must go through here.
func CompressionExtension(c FileCompression) string {
	switch c {
	case FileCompressionGZIP:
		return compression.SuffixGzip
	case FileCompressionZSTD:
		return compression.SuffixZstd
	default:
		return ""
	}
}

// CompressionContentType is the Content-Type to label a compressed object with,
// or "" when the object is uncompressed and the caller should fall back to the
// content type of the format.
//
// Customers read their own S3/GCS objects directly, so an object compressed with
// one codec and labelled as another is a support ticket waiting to happen.
func CompressionContentType(compression FileCompression) string {
	switch compression {
	case FileCompressionGZIP:
		return "application/gzip"
	case FileCompressionZSTD:
		return "application/zstd"
	default:
		return ""
	}
}
