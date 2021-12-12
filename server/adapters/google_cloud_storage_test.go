package adapters

import (
	"github.com/stretchr/testify/assert"
	"testing"
)

func TestValidate_WorkloadIdentity_ServiceAccountKey_pass_dont_set_credentials(t *testing.T) {
	uut := &GoogleConfig{
		Bucket:      "foo",
		Project:     "bar",
		Dataset:     "baz",
		KeyFile:     "workload_identity",
	}

	err := uut.Validate()

	assert.Nilf(t, err, "err %v", err)
	err = uut.ValidateBatchMode()
	assert.Nilf(t, err, "err %v", err)

	assert.Nil(t, uut.credentials)
}
