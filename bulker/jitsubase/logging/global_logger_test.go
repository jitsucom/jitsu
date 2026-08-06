package logging

import (
	"bytes"
	"strings"
	"testing"

	log "github.com/sirupsen/logrus"
)

// The "System error:" marker is matched verbatim by log-based alerting, so Fatal
// and Fatalf have to emit it the same way. They do not share an implementation:
// Fatalf concatenates the marker into the format string, while Fatal prepends it
// as an operand and lets logrus join them - and logrus renders Fatal with
// fmt.Sprint, which puts no space between two string operands.
func TestFatalMarkerMatchesFatalf(t *testing.T) {
	const marker = "System error: "

	capture := func(emit func()) string {
		var buf bytes.Buffer
		logger := log.StandardLogger()
		prevOut, prevFormatter, prevExit := logger.Out, logger.Formatter, logger.ExitFunc
		logger.SetOutput(&buf)
		logger.SetFormatter(&log.TextFormatter{DisableTimestamp: true, DisableColors: true})
		// Fatal calls os.Exit(1) once the entry is written; swallow it so the
		// test can inspect what was written.
		logger.ExitFunc = func(int) {}
		defer func() {
			logger.SetOutput(prevOut)
			logger.SetFormatter(prevFormatter)
			logger.ExitFunc = prevExit
		}()
		emit()
		return buf.String()
	}

	fatal := capture(func() { Fatal("cannot start") })
	fatalf := capture(func() { Fatalf("%s", "cannot start") })

	for name, out := range map[string]string{"Fatal": fatal, "Fatalf": fatalf} {
		if !strings.Contains(out, marker+"cannot start") {
			t.Errorf("%s: want %q followed by the message, got %q", name, marker, out)
		}
	}
}

// Multiple operands must stay separated too - fmt.Sprint would run them together
// ("System error:cannot startboom") because they are all strings.
func TestFatalSeparatesOperands(t *testing.T) {
	var buf bytes.Buffer
	logger := log.StandardLogger()
	prevOut, prevFormatter, prevExit := logger.Out, logger.Formatter, logger.ExitFunc
	logger.SetOutput(&buf)
	logger.SetFormatter(&log.TextFormatter{DisableTimestamp: true, DisableColors: true})
	logger.ExitFunc = func(int) {}
	defer func() {
		logger.SetOutput(prevOut)
		logger.SetFormatter(prevFormatter)
		logger.ExitFunc = prevExit
	}()

	Fatal("cannot start", "boom")

	if want := "System error: cannot start boom"; !strings.Contains(buf.String(), want) {
		t.Errorf("want %q, got %q", want, buf.String())
	}
}
