package reload

import (
	"errors"
	"io"
	"log"
	"strings"
	"time"
)

type ReloadableResource struct {
	location string
	additionalParams map[string]string
	currentInstance interface{}
	time.Time lastModified;
	factory func(reader io.Reader) interface{}
}

func (r *ReloadableResource) CurrentInstance() (instance interface{}, err error) {
	if (r.currentInstance == nil) {
		return nil, errors.New("Call Initialize() first")
	}
	return r.currentInstance, nil
}



func (r *ReloadableResource) Initialize() (err error) {
	loader := GetLoader(r.location, r.additionalParams);
	log.Printf("Loading initial version of %s\n", r.location)
	resource, err := loader.Load()

	if err != nil {
		log.Printf("Failed to load %s: %v\n", r.location, err)
		return err;
	}

	r.currentInstance = r.factory(resource.reader)

	ticker := time.NewTicker(5 * time.Second)
	quit := make(chan struct{})
	go func() {
		for {
			select {
			case <- ticker.C:
				// do stuff
			case <- quit:
				ticker.Stop()
				return
			}
		}
	}()

	return nil;
}

// Encapsulates a resource (such as URL or file) that have a
// modification time and stream of data
type Resource struct {
	lastModified time.Time
	reader io.Reader
}

//Loads a Resource (see below)
type ResourceLoader interface {
	Load() (res Resource, err error)
	LastModified() time.Time
}

type LocalFileLoader struct {
	location string
}

func (l *LocalFileLoader) LastModified() time.Time {
	panic("implement me")
}

type URLLoader struct {
	url string
	additionalParameters map[string]string

}

func (U *URLLoader) LastModified() time.Time {
	panic("implement me")
}

func NewURLFileLoader(url string, additionalParameters map[string]string) *URLLoader {
	return &URLLoader{url: url, additionalParameters: additionalParameters}
}

func (U *URLLoader) Load() (res Resource, err error) {
	panic("implement me")
}

func (l *LocalFileLoader) Load() (res Resource, err error) {
	panic("implement me")
}

//Gets a appropriate
func GetLoader(location string, additional map[string]string) ResourceLoader  {
	if strings.HasPrefix(location, "http://") || strings.HasPrefix(location, "https//") {
		return &URLLoader{
			url:                  location,
			additionalParameters: additional,
		};
	} else {
		return &LocalFileLoader{location: location};
	}
}

