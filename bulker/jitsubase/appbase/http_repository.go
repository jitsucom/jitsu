package appbase

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

type CacheTagHeader string

const (
	HTTPTagLastModified CacheTagHeader = "last-modified"
	HTTPTagETag         CacheTagHeader = "etag"
	HTTPTagNone         CacheTagHeader = ""
)

type HTTPRepository[T any] struct {
	*AbstractRepository[T]
	url       string
	token     string
	tagHeader CacheTagHeader
}

func NewHTTPRepository[T any](id, url, token string, tagHeader CacheTagHeader, emptyData RepositoryData[T], attempts int, refreshPeriodSec int, cacheDir string, noDataPolicy NoDataPolicy) *HTTPRepository[T] {
	a := NewAbstractRepository[T](id, emptyData, nil, attempts, refreshPeriodSec, cacheDir, noDataPolicy)
	r := &HTTPRepository[T]{
		AbstractRepository: a,
		url:                url,
		token:              token,
	}
	r.dataSource = r.loadFromHttp
	r.tagHeader = tagHeader
	r.refresh(false)
	r.start()
	return r
}

func (r *HTTPRepository[T]) loadFromHttp(tag any) (reader io.ReadCloser, newTag any, modified bool, err error) {
	req, err := http.NewRequest("GET", r.url, nil)
	if err != nil {
		err = r.NewError("Error creating request for loading repository from %s: %v", r.url, err)
		return
	}
	if tag != nil && r.tagHeader != HTTPTagNone {
		switch r.tagHeader {
		case HTTPTagLastModified:
			r.Debugf("Loading repository from %s with If-Modified-Since: %v", r.url, tag)
			req.Header.Add("If-Modified-Since", (tag.(time.Time)).Format(http.TimeFormat))
		case HTTPTagETag:
			r.Debugf("Loading repository from %s with If-None-Match: %s", r.url, tag)
			req.Header.Add("If-None-Match", tag.(string))
		}
	} else {
		r.Debugf("Loading repository from %s", r.url)
	}
	if r.token != "" {
		req.Header.Add("Authorization", fmt.Sprintf("Bearer %s", r.token))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		err = fmt.Errorf("Error loading repository from %s: %v", r.url, err)
		return
	}
	if resp.StatusCode == http.StatusNotModified {
		_ = resp.Body.Close()
		return nil, tag, false, nil
	} else if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		err = fmt.Errorf("Error loading repository from %s http status: %v resp: %s", r.url, resp.StatusCode, string(b))
		return
	}
	if r.tagHeader == HTTPTagETag {
		etag := any(resp.Header.Get("etag"))
		if etag != "" {
			newTag = etag
		}
	} else if r.tagHeader == HTTPTagLastModified {
		lastModified := resp.Header.Get("last-modified")
		if lastModified != "" {
			t, err := time.Parse(http.TimeFormat, lastModified)
			if err != nil {
				r.Errorf("Error parsing last-modified header: %v", err)
			} else {
				newTag = t
			}
		}
	}
	return resp.Body, newTag, true, nil
}
