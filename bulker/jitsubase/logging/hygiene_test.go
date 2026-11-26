package logging

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// JITSU-302: no log call or error may be handed a configuration or a credential. A configuration holds the credentials of
// the user's databases and APIs; logs go to places with a wider audience than the code that wrote them. The check parses
// every Go file under bulker/ and looks at the arguments of the calls that log or build an error message.

// logging and error-building calls: their arguments end up in a log or in an error that is logged
var loggingCalls = map[string]bool{
	"Infof": true, "Errorf": true, "Warnf": true, "Debugf": true, "Printf": true, "Fatalf": true, "Panicf": true,
	"Info": true, "Error": true, "Warn": true, "Debug": true, "Fatal": true, "Println": true, "SystemErrorf": true,
	"SystemError": true, "NewError": true,
}

// compared in lower case: names that stand for a configuration or a credential
var deniedNames = map[string]bool{
	"cfg": true, "config": true, "conf": true, "destinationconfig": true, "dstcfg": true, "sourceconfig": true,
	"streamconfig": true, "creds": true, "credentials": true, "password": true, "passwd": true, "secret": true,
	"secretkey": true, "token": true, "accesstoken": true, "refreshtoken": true, "apikey": true, "privatekey": true,
	"authorization": true, "authtoken": true, "sasl": true,
}

// where a call deliberately names one of the above, with the reason. `verb` is the format verb the argument must have:
// "T" prints the type of a value and never the value, so an exemption for a configuration is only valid with it. An empty
// verb allows any, for a name that is not a credential at all.
type allowance struct{ reason, verb string }

var allowed = map[string]allowance{
	"jitsubase/utils/objects.go:cfg":       {"%T prints the type of the value, not the value", "T"},
	"operator/operator.go:tscConfig":       {"pod topology spread constraints: scheduling settings, no credentials", ""},
	"operator/operator.go:resourcesConfig": {"pod resource requests and limits: no credentials", ""},
}

func isAllowed(rel string, f finding) bool {
	a, ok := allowed[rel+":"+f.name]
	return ok && (a.verb == "" || a.verb == f.verb)
}

// formatVerbs lists the verb of every argument that a printf-style format consumes, in order ("%+v" is "v", "%%" consumes
// none, "%*d" consumes two). It gives up (nil) on explicit argument indexes, which the exemptions cannot rely on.
func formatVerbs(format string) []string {
	var verbs []string
	for i := 0; i < len(format); i++ {
		if format[i] != '%' {
			continue
		}
		i++
		if i < len(format) && format[i] == '%' {
			continue
		}
		for i < len(format) && strings.IndexByte("+-# 0123456789.*[", format[i]) >= 0 {
			switch format[i] {
			case '[':
				return nil
			case '*':
				verbs = append(verbs, "*")
			}
			i++
		}
		if i < len(format) {
			verbs = append(verbs, string(format[i]))
		}
	}
	return verbs
}

// isDeniedName: the exact names above, and any name that ends in config or cfg (connectionConfig, serviceCfg, rawConfig)
func isDeniedName(name string) bool {
	lower := strings.ToLower(name)
	return deniedNames[lower] || strings.HasSuffix(lower, "config") || strings.HasSuffix(lower, "cfg")
}

type finding struct {
	file string
	line int
	name string
	verb string // the format verb of the argument, when the call is printf-style with a literal format
}

func inspectArgs(e ast.Expr, names *[]string) {
	switch v := e.(type) {
	case *ast.BasicLit:
		return // text is not a value
	case *ast.Ident:
		*names = append(*names, v.Name)
	case *ast.SelectorExpr:
		// the value is the last name: `cfg.Port` is a port, `r.cfg` is a configuration
		*names = append(*names, v.Sel.Name)
	case *ast.CallExpr:
		if id, ok := v.Fun.(*ast.Ident); ok && (id.Name == "len" || id.Name == "cap") {
			return // a size cannot leak the value
		}
		if sel, ok := v.Fun.(*ast.SelectorExpr); ok {
			if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "maps" && sel.Sel.Name == "Keys" {
				return // the names of the keys, not the values
			}
			// MapNVL(config, "id", ...) reads one named field: only the fields that are not secrets are accepted
			if sel.Sel.Name == "MapNVL" && len(v.Args) >= 2 {
				if lit, ok := v.Args[1].(*ast.BasicLit); ok && (lit.Value == `"id"` || lit.Value == `"destinationType"`) {
					return
				}
			}
		}
		for _, a := range v.Args {
			inspectArgs(a, names)
		}
	case *ast.UnaryExpr:
		inspectArgs(v.X, names)
	case *ast.StarExpr:
		inspectArgs(v.X, names)
	case *ast.ParenExpr:
		inspectArgs(v.X, names)
	case *ast.IndexExpr:
		inspectArgs(v.X, names)
	case *ast.BinaryExpr:
		inspectArgs(v.X, names)
		inspectArgs(v.Y, names)
	}
}

// findSecretsInLogCalls returns the logging calls of the given source whose arguments are a denied name
func findSecretsInLogCalls(fileName, src string) ([]finding, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, fileName, src, 0)
	if err != nil {
		return nil, err
	}
	var out []finding
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || !loggingCalls[sel.Sel.Name] {
			return true
		}
		var verbs []string
		printf := strings.HasSuffix(sel.Sel.Name, "f") || sel.Sel.Name == "NewError"
		if printf && len(call.Args) > 0 {
			if lit, ok := call.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
				if format, uerr := strconv.Unquote(lit.Value); uerr == nil {
					verbs = formatVerbs(format)
				}
			}
		}
		for i, a := range call.Args {
			var names []string
			inspectArgs(a, &names)
			verb := ""
			if printf && i >= 1 && i-1 < len(verbs) {
				verb = verbs[i-1]
			}
			for _, name := range names {
				if isDeniedName(name) {
					out = append(out, finding{fileName, fset.Position(call.Pos()).Line, name, verb})
				}
			}
		}
		return true
	})
	return out, nil
}

func TestCheckerFindsAConfigInALogCall(t *testing.T) {
	for _, tc := range []struct{ code, name string }{
		{`func f(){ base.Debugf("parsed %s: %+v", id, cfg) }`, "cfg"},
		{`func f(){ return fmt.Errorf("no credentials in %+v", cfg) }`, "cfg"},
		{`func f(){ r.Errorf("failed: %s: %v", id, config, err) }`, "config"},
		{`func f(){ rcs.Debugf("parsed %s.", id, dstCfg) }`, "dstCfg"},
		{`func f(){ log.Infof("x %v", r.destinationConfig) }`, "destinationConfig"},
		{`func f(){ log.Warnf("x %v", *cfg) }`, "cfg"},
		{`func f(){ log.Infof("x %s", fmt.Sprint(password)) }`, "password"},
		{`func f(){ log.Infof("x %v", maps.Values(cfg)) }`, "cfg"},
		{`func f(){ log.Infof("x %v", utils.MapNVL(destinationConfig, "credentials", "")) }`, "destinationConfig"},
		{`func f(){ log.Infof("x %v", utils.MapNVL(destinationConfig, key, "")) }`, "destinationConfig"},
	} {
		got, err := findSecretsInLogCalls("x.go", "package p\n"+tc.code)
		if err != nil || len(got) == 0 || got[0].name != tc.name {
			t.Errorf("%s: expected to find %q, got %v (err %v)", tc.code, tc.name, got, err)
		}
	}
}

// a name that ends in config or cfg stands for a configuration, whatever comes before it: the first list had only the exact names
func TestCheckerFindsAnyNameThatEndsInConfig(t *testing.T) {
	for _, tc := range []struct{ code, name string }{
		{`func f(){ r.Errorf("failed to parse config for %s: %s: %v", id, connectionConfig, err) }`, "connectionConfig"},
		{`func f(){ log.Infof("x %v", appConfig) }`, "appConfig"},
		{`func f(){ log.Infof("x %v", s.serviceCfg) }`, "serviceCfg"},
		{`func f(){ log.Infof("x %v", rawConfig) }`, "rawConfig"},
	} {
		got, err := findSecretsInLogCalls("x.go", "package p\n"+tc.code)
		if err != nil || len(got) == 0 || got[0].name != tc.name {
			t.Errorf("%s: expected to find %q, got %v (err %v)", tc.code, tc.name, got, err)
		}
	}
}

func TestCheckerLeavesAloneWhatCannotLeak(t *testing.T) {
	for _, code := range []string{
		`func f(){ log.Infof("the config is loaded") }`,
		`func f(){ log.Infof("port %d", cfg.Port) }`,
		`func f(){ log.Infof("%d keys", len(cfg)) }`,
		`func f(){ x.Push(config) }`,
		`func f(){ log.Infof("%s %v", utils.MapNVL(destinationConfig, "id", ""), utils.MapNVL(destinationConfig, "destinationType", "")) }`,
		`func f(){ log.Infof("keys: %v", slices.Sorted(maps.Keys(cfg))) }`,
		`func f(){ log.Infof("name %s", id) }`,
	} {
		if got, err := findSecretsInLogCalls("x.go", "package p\n"+code); err != nil || len(got) != 0 {
			t.Errorf("%s: expected nothing, got %v (err %v)", code, got, err)
		}
	}
}

func TestNoLogCallIsHandedAConfigOrACredential(t *testing.T) {
	root, _ := filepath.Abs("../..") // bulker/
	var problems []string
	files := 0
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && (d.Name() == "vendor" || d.Name() == "node_modules" || d.Name() == ".git") {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		src, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil
		}
		files++
		found, perr := findSecretsInLogCalls(rel, string(src))
		if perr != nil {
			return nil
		}
		for _, f := range found {
			if isAllowed(rel, f) {
				continue
			}
			problems = append(problems, rel+":"+strconv.Itoa(f.line)+" passes \""+f.name+"\" to a log or error call")
		}
		return nil
	})
	if files < 200 {
		t.Fatalf("the check scanned only %d files: the root is wrong", files)
	}
	sort.Strings(problems)
	for _, p := range problems {
		t.Error(p)
	}
}

func TestFormatVerbs(t *testing.T) {
	for format, want := range map[string]string{
		"a %T b %+v c %s": "T v s",
		"100%% of %d":     "d",
		"%5.2f and %-8s":  "f s",
		"%*d":             "* d",
		"no verbs":        "",
		"%[2]d %[1]d":     "(gave up)",
	} {
		got := strings.Join(formatVerbs(format), " ")
		if want == "(gave up)" {
			if formatVerbs(format) != nil {
				t.Errorf("%q: expected to give up, got %v", format, got)
			}
			continue
		}
		if got != want {
			t.Errorf("%q: expected %q, got %q", format, want, got)
		}
	}
}

// the exemption of `cfg` in utils/objects.go is for the type only: formatting the value there would log the configuration
func TestAnExemptionForAConfigHoldsOnlyForTheTypeVerb(t *testing.T) {
	verbOf := func(code string) string {
		got, err := findSecretsInLogCalls("jitsubase/utils/objects.go", "package p\n"+code)
		if err != nil || len(got) != 1 {
			t.Fatalf("%s: expected one finding, got %v (err %v)", code, got, err)
		}
		return got[0].verb
	}
	if v := verbOf(`func f(){ _ = fmt.Errorf("can't parse object from type: %T", cfg) }`); v != "T" {
		t.Errorf("expected verb T, got %q", v)
	}
	allowedAsIs := func(code string) bool {
		got, _ := findSecretsInLogCalls("jitsubase/utils/objects.go", "package p\n"+code)
		return len(got) == 1 && isAllowed("jitsubase/utils/objects.go", got[0])
	}
	if !allowedAsIs(`func f(){ _ = fmt.Errorf("can't parse object from type: %T", cfg) }`) {
		t.Errorf("%%T must stay allowed")
	}
	for _, code := range []string{
		`func f(){ _ = fmt.Errorf("can't parse object from type: %+v", cfg) }`,
		`func f(){ _ = fmt.Errorf("can't parse object from type: %v", cfg) }`,
		`func f(){ _ = fmt.Errorf("can't parse %s: %T", cfg, x) }`, // the %T belongs to x, cfg is formatted with %s
		`func f(){ log.Error(cfg) }`,                               // no format at all
	} {
		if allowedAsIs(code) {
			t.Errorf("%s must NOT be allowed", code)
		}
	}
	if isAllowed("other/file.go", finding{name: "cfg", verb: "T"}) {
		t.Errorf("the exemption is for one file only")
	}
}
