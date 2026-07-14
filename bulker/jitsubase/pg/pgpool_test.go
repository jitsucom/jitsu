package pg

import (
	"testing"
)

func TestPoolConfigStripsPrismaSchemaParam(t *testing.T) {
	cfg, err := poolConfig("postgres://u:p@h:5432/db?schema=newjitsu")
	if err != nil {
		t.Fatal(err)
	}
	if v, ok := cfg.ConnConfig.RuntimeParams["schema"]; ok {
		t.Errorf("schema=%q must not be sent to the server (FATAL 42704)", v)
	}
	if got := cfg.ConnConfig.RuntimeParams["search_path"]; got != "newjitsu" {
		t.Errorf("search_path = %q, want %q", got, "newjitsu")
	}
	if cfg.AfterConnect == nil {
		t.Error("AfterConnect hook for SET search_path not installed")
	}
}

func TestPoolConfigPlainURL(t *testing.T) {
	cfg, err := poolConfig("postgres://u:p@h:5432/db")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := cfg.ConnConfig.RuntimeParams["search_path"]; ok {
		t.Error("search_path must not be set for URLs without schema/search_path")
	}
}

func TestExtractSchema(t *testing.T) {
	for url, want := range map[string]string{
		"postgres://u:p@h:5432/db?schema=newjitsu":                 "newjitsu",
		"postgres://u:p@h:5432/db?search_path=custom":              "custom",
		"postgres://u:p@h:5432/db?schema=newjitsu&sslmode=require": "newjitsu",
		"postgres://u:p@h:5432/db":                                 "",
	} {
		if got := extractSchema(url); got != want {
			t.Errorf("extractSchema(%q) = %q, want %q", url, got, want)
		}
	}
}
