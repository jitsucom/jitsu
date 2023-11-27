package utils

func ArrayContains(arr []interface{}, value interface{}) bool {
	for _, a := range arr {
		if a == value {
			return true
		}
	}
	return false
}
