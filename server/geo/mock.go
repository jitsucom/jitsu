package geo

import "errors"

type Mock map[string]*Data

func (m Mock) Resolve(ip string) (*Data, error) {
	data, ok := m[ip]
	if !ok {
		return nil, errors.New("Data wasn't found")
	}
	return data, nil
}

func (m Mock) Type() string {
	return MaxmindType
}

func (m Mock) Close() error {
	return nil
}
