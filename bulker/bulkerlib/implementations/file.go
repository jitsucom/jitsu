package implementations

import (
	"fmt"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"io"
	"strings"
	"time"
)

var folderMacro = map[string]func() string{
	"[DATE]": func() string {
		return time.Now().Format("2006-01-02")
	},
	"[TIMESTAMP]": func() string {
		return fmt.Sprintf("%d", time.Now().Unix())
	},
}

type FileAdapter interface {
	io.Closer
	Type() string
	Ping() error
	UploadBytes(fileName string, fileBytes []byte) error
	Upload(fileName string, fileReader io.ReadSeeker) error
	// GetObjectURL returns http URL to uploaded object.
	// It is short-lived signed URL if the corresponding setting (e.g. S3Config.UsePresignedURL ) is enabled on adapter config
	// Otherwise, it returns URL build with public URL template which won't work if the object is private
	GetObjectURL(fileName string) (url string, err error)
	Download(fileName string) ([]byte, error)
	DeleteObject(key string) error
	Path(fileName string) string
	AddFileExtension(fileName string) string
	Format() types.FileFormat
	Compression() types.FileCompression
}

type FileConfig struct {
	Folder      string                `mapstructure:"folder" json:"folder,omitempty" yaml:"folder,omitempty"`
	Format      types.FileFormat      `mapstructure:"format,omitempty" json:"format,omitempty" yaml:"format,omitempty"`
	Compression types.FileCompression `mapstructure:"compression,omitempty" json:"compression,omitempty" yaml:"compression,omitempty"`
}

type AbstractFileAdapter struct {
	config *FileConfig
}

func (a *AbstractFileAdapter) Format() types.FileFormat {
	return a.config.Format
}

func (a *AbstractFileAdapter) Compression() types.FileCompression {
	return a.config.Compression
}

func (a *AbstractFileAdapter) AddFileExtension(fileName string) string {
	ext := ""
	switch a.config.Format {
	case types.FileFormatCSV:
		ext = ".csv"
	case types.FileFormatNDJSON, types.FileFormatNDJSONFLAT:
		ext = ".ndjson"
	}
	// Via the shared helper rather than a local switch: readers here pick their
	// decompressor from the file name, so a compression this misses produces an
	// object that is silently unreadable rather than merely misnamed.
	gz := types.CompressionExtension(a.config.Compression)
	if strings.HasSuffix(fileName, ext) {
		return fileName + gz
	} else if strings.HasSuffix(fileName, ext+gz) {
		return fileName
	} else {
		return fileName + ext + gz
	}
}

func (a *AbstractFileAdapter) Path(fileName string) string {
	folder := a.config.Folder
	if folder != "" {
		folder = replaceMacro(folder)
		if !strings.HasSuffix(folder, "/") {
			folder += "/"
		}
	}
	return fmt.Sprintf("%s%s", folder, fileName)
}

func replaceMacro(folder string) string {
	for macro, fn := range folderMacro {
		folder = strings.ReplaceAll(folder, macro, fn())
	}
	return folder
}

//func (c FileConfig) PrepareFile(fileName *string, fileBytes *[]byte) error {
//	if c.Folder != "" {
//		*fileName = c.Folder + "/" + *fileName
//	}
//
//	if c.Compression == FileCompressionGZIP {
//		*fileName = fileNameGZIP(*fileName)
//		if fileBytes != nil {
//			var err error
//			buf, err := compressGZIP(*fileBytes)
//			if err != nil {
//				return fmt.Errorf("Error compressing file %v", err)
//			}
//
//			*fileBytes = buf.Bytes()
//		}
//	}
//
//	return nil
//}

//func (c *FileConfig) RequireDefaultStage(storageType string) {
//	if c.Folder != "" {
//		logging.Warnf("customizing folder [%s] is not supported for [%s] stage, using root directory", c.Folder, storageType)
//		c.Folder = ""
//	}
//
//	if c.Compression != "" {
//		logging.Warnf("customizing compression [%s] is not supported for [%s] stage, using no compression", c.Compression, storageType)
//		c.Compression = ""
//	}
//}

//func fileNameGZIP(fileName string) string {
//	return fileName + ".gz"
//}
//
//func compressGZIP(b []byte) (*bytes.Buffer, error) {
//	buf := new(bytes.Buffer)
//	w := gzip.NewWriter(buf)
//	defer w.Close()
//	if _, err := w.Write(b); err != nil {
//		return nil, err
//	}
//	return buf, nil
//}
