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

// where a call deliberately names one of the above, with the reason; empty on purpose
var allowed = map[string]string{
	"jitsubase/utils/objects.go:cfg": "%T prints the type of the value, not the value",
}

type finding struct {
	file string
	line int
	name string
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
		var names []string
		for _, a := range call.Args {
			inspectArgs(a, &names)
		}
		for _, name := range names {
			if deniedNames[strings.ToLower(name)] {
				out = append(out, finding{fileName, fset.Position(call.Pos()).Line, name})
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
			if allowed[rel+":"+f.name] != "" {
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
