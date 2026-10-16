package clickhouse_replicated_db

import (
	"context"
	"errors"
	"testing"

	tc "github.com/testcontainers/testcontainers-go/modules/compose"
)

type shutdownStack struct {
	tc.ComposeStack
	err error
}

func (s shutdownStack) Down(context.Context, ...tc.StackDownOption) error {
	return s.err
}

func TestClose(t *testing.T) {
	want := errors.New("shutdown failed")
	for _, err := range []error{nil, want} {
		container := &ClickHouseReplicatedDBContainer{Compose: shutdownStack{err: err}}
		if got := container.Close(); !errors.Is(got, err) {
			t.Fatalf("Close() = %v, want %v", got, err)
		}
	}
}
