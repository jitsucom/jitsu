package adapters

import (
	"bytes"
	"compress/gzip"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

type (
	FileEncodingFormat string
	FileCompression    string
)

const (
	FileFormatFlatJSON  FileEncodingFormat = "flat_json" //flattened json objects with \n delimiter
	FileFormatJSON      FileEncodingFormat = "json"      //file with json objects with \n delimiter (not flattened)
	FileFormatCSV       FileEncodingFormat = "csv"       //flattened csv objects with \n delimiter
	FileFormatParquet   FileEncodingFormat = "parquet"   //flattened objects which are marshalled in apache parquet file
	FileCompressionGZIP FileCompression    = "gzip"      //gzip compression
)

type FileConfig struct {
	Folder      string             `mapstructure:"folder,omitempty" json:"folder,omitempty" yaml:"folder,omitempty"`
	Format      FileEncodingFormat `mapstructure:"format,omitempty" json:"format,omitempty" yaml:"format,omitempty"`
	Compression FileCompression    `mapstructure:"compression,omitempty" json:"compression,omitempty" yaml:"compression,omitempty"`
}

func (c FileConfig) PrepareFile(fileName *string, fileBytes *[]byte) error {
	if c.Folder != "" {
		*fileName = c.Folder + "/" + *fileName
	}

	if c.Compression == FileCompressionGZIP {
		*fileName = fileNameGZIP(*fileName)
		if fileBytes != nil {
			var err error
			buf, err := compressGZIP(*fileBytes)
			if err != nil {
				return errors.Errorf("Error compressing file %v", err)
			}

			*fileBytes = buf.Bytes()
		}
	}

	return nil
}

func (c *FileConfig) RequireDefaultStage(storageType string) {
	if c.Folder != "" {
		logging.Warnf("customizing folder [%s] is not supported for [%s] stage, using root directory", c.Folder, storageType)
		c.Folder = ""
	}

	if c.Compression != "" {
		logging.Warnf("customizing compression [%s] is not supported for [%s] stage, using no compression", c.Compression, storageType)
		c.Compression = ""
	}
}

func fileNameGZIP(fileName string) string {
	return fileName + ".gz"
}

func compressGZIP(b []byte) (*bytes.Buffer, error) {
	buf := new(bytes.Buffer)
	w := gzip.NewWriter(buf)
	defer w.Close()
	if _, err := w.Write(b); err != nil {
		return nil, err
	}
	return buf, nil
}
