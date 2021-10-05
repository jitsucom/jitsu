package logging

type TaskLogger interface {
	INFO(format string, v ...interface{})
	ERROR(format string, v ...interface{})

	//Write is used by Singer
	Write(p []byte) (n int, err error)
}
