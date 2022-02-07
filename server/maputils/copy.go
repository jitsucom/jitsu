package maputils

//CopyMap returns copy of input map with all sub objects
func CopyMap(m map[string]interface{}) map[string]interface{} {
	cp := make(map[string]interface{}, len(m))
	for k, v := range m {
		vm, ok := v.(map[string]interface{})
		if ok {
			cp[k] = CopyMap(vm)
		} else {
			cp[k] = v
		}
	}

	return cp
}

//CopySet returns copy of input set
func CopySet(m map[string]bool) map[string]bool {
	cs := make(map[string]bool, len(m))
	for k, v := range m {
		cs[k] = v
	}

	return cs
}
