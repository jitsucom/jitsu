package base

import "errors"

//ErrAlreadyLocked is about already locked resource in coordination service
var ErrAlreadyLocked = errors.New("Resource has been already locked")
