package sql

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// pgParamName is what libpq accepts as a connection parameter name. Anything else (a space, '=', a quote) in a
// user-supplied name would start a new setting, so it is refused instead of quoted.
var pgParamName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// pgSetting is one `name=value` of a libpq keyword/value connection string.
type pgSetting struct {
	Name  string
	Value string
}

// quotePgValue quotes a value for a libpq keyword/value connection string: in single quotes, with ' and \ escaped.
// Unquoted, a space in a value starts a new setting (`dbname=events host=attacker.example` changes the host) and an
// empty value swallows the next setting (`password= search_path=public` makes the password `search_path=public`).
func quotePgValue(value string) string {
	var b strings.Builder
	b.Grow(len(value) + 2)
	b.WriteByte('\'')
	for _, r := range value {
		if r == '\'' || r == '\\' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	b.WriteByte('\'')
	return b.String()
}

// pgConnectionString builds a libpq keyword/value connection string from the given settings in order, followed by the
// extra parameters in name order. Every value is quoted; a parameter name that is not a plain identifier, or a value
// with a NUL byte (which libpq cannot carry), is an error.
func pgConnectionString(settings []pgSetting, params map[string]string) (string, error) {
	names := make([]string, 0, len(params))
	for name := range params {
		names = append(names, name)
	}
	sort.Strings(names)
	all := append([]pgSetting{}, settings...)
	for _, name := range names {
		all = append(all, pgSetting{Name: name, Value: params[name]})
	}
	parts := make([]string, 0, len(all))
	for _, s := range all {
		if !pgParamName.MatchString(s.Name) {
			return "", fmt.Errorf("invalid connection parameter name %q", s.Name)
		}
		if strings.ContainsRune(s.Value, 0) {
			return "", fmt.Errorf("connection parameter %q contains a NUL character", s.Name)
		}
		parts = append(parts, s.Name+"="+quotePgValue(s.Value))
	}
	return strings.Join(parts, " "), nil
}
