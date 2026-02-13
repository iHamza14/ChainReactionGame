package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(write http.ResponseWriter, read *http.Request) {
		fmt.Fprintln(write, "Game server running")
	})

	fmt.Println("Server started on :8080")
	http.ListenAndServe(":8080", nil)
}
