package users

import (
	"bytes"
	"compress/gzip"
	"io/ioutil"

	"encoding/json"
)

type GZIPCompressor struct{}

func (c *GZIPCompressor) Compress(payload interface{}) []byte {
	b, _ := json.Marshal(payload)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(b)
	gz.Close()

	return buf.Bytes()
}

func (c *GZIPCompressor) Decompress(compressed []byte) (map[string]interface{}, error) {
	r, _ := gzip.NewReader(bytes.NewReader(compressed))
	result, _ := ioutil.ReadAll(r)

	m := map[string]interface{}{}
	err := json.Unmarshal(result, &m)
	return m, err
}
