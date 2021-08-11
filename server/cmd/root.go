package cmd

import (
	"fmt"
	au "github.com/logrusorgru/aurora"
	"github.com/spf13/cobra"
	"os"
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:    "",
	Short:  "Jitsu CLI tool for bulk uploading files with events into Jitsu",
	Long:   `Jitsu CLI tool for bulk uploading files with events into Jitsu. Common use case: upload archive logs (aka replay)`,
	Hidden: true,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		fmt.Fprintln(os.Stderr, au.Index(1, fmt.Sprintf("Error: %v", err)).String())
		os.Exit(1)
	}
}

func init() {}
