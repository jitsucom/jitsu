package oauth

type SecretValue struct {
	Value    string
	EnvName  string
	YAMLPath string
	Provided bool
}

type Secrets = map[string]SecretValue

type Interface interface {
	Get(id string) (Secrets, bool)
}

var instance Interface = new(ConfigService)

func Set(service Interface) {
	instance = service
}

func Get(id string) (Secrets, bool) {
	return instance.Get(id)
}
