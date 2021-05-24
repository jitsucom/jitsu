package logging

type TaskLogger interface {
	OUTPUT(system, stdErrOutput string)
	INFO(format string, v ...interface{})
	ERROR(format string, v ...interface{})
}
