package random

import (
	"math/rand"
	"time"
)

const alphabeticalCharset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

const charset = "abcdefghijklmnopqrstuvwxyz" +
	"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

const lowerCharset = "abcdefghijklmnopqrstuvwxyz" +
	"0123456789"

var seededRand *rand.Rand = rand.New(
	rand.NewSource(time.Now().UnixNano()))

func StringWithCharset(length int, charset string) string {
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[seededRand.Intn(len(charset))]
	}
	return string(b)
}

func LowerString(length int) string {
	return StringWithCharset(length, lowerCharset)
}

func String(length int) string {
	return StringWithCharset(length, charset)
}

func AlphabeticalString(length int) string {
	return StringWithCharset(length, alphabeticalCharset)
}
