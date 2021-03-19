package logging

type TaskLogger interface {
	INFO(format string, v ...interface{})
	ERROR(format string, v ...interface{})
}
