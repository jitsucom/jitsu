package implementations

import "testing"

// TestGoogleConfigValidateForbidsAmbient locks in that Validate() requires an
// explicit credential and never accepts ambient / Application Default
// Credentials — the single chokepoint every gcs/bigquery construction path
// flows through. See the confused-deputy note on Validate().
func TestGoogleConfigValidateForbidsAmbient(t *testing.T) {
	cases := []struct {
		name    string
		keyFile any
		wantErr bool
	}{
		{"workload_identity sentinel", "workload_identity", true},
		{"empty string", "", true},
		{"absent keyFile (nil)", nil, true},
		{"empty map", map[string]any{}, true},
		{"wrong type", 42, true},
		{"json key string", `{"type":"service_account"}`, false},
		{"json key object", map[string]any{"type": "service_account"}, false},
		{"file path", "/etc/gcp/key.json", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gc := &GoogleConfig{KeyFile: c.keyFile}
			err := gc.Validate()
			if (err != nil) != c.wantErr {
				t.Fatalf("Validate() err=%v, wantErr=%v", err, c.wantErr)
			}
			if err == nil && gc.Credentials == nil {
				t.Fatalf("Validate() succeeded but left Credentials nil — an ADC path")
			}
		})
	}
}
