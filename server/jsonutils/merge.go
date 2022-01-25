package jsonutils

//Merge puts all keys from the right map into the left map with deep overwriting
//returns merged map result
func Merge(left map[string]interface{}, right map[string]interface{}) map[string]interface{} {
	if right == nil {
		return left
	}
	if left == nil {
		return right
	}

	for rk, rv := range right {
		//handle delete
		if rv == nil {
			delete(left, rk)
			continue
		}

		if rvObj, ok := rv.(map[string]interface{}); ok {
			if lv, ok := left[rk]; ok {
				if lvObj, ok := lv.(map[string]interface{}); ok {
					lvObj = Merge(lvObj, rvObj)
					left[rk] = lvObj
				} else {
					lvObj[rk] = rv
				}
			} else {
				left[rk] = rv
			}
		} else {
			left[rk] = rv
		}
	}

	return left
}
