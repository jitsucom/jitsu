package google_ads

import "fmt"

func ExampleLoadFieldTypes() {
	var err error
	// uncomment this line to refresh fields.csv. But comment it back before committing to repo.
	// err = LoadFieldTypes()
	if err != nil {
		fmt.Println(err)
		return
	}
	fmt.Println("ok")
	// Output: ok
}
