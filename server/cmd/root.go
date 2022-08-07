package cmd

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/uuid"
	au "github.com/logrusorgru/aurora"
	"github.com/spf13/cobra"
)

const serviceName = "cli"

var version = ""

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:    "",
	Short:  "Jitsu CLI tool for bulk uploading files with events into Jitsu",
	Long:   `Jitsu CLI tool for bulk uploading files with events into Jitsu. Common use case: upload archive logs (aka replay)`,
	Hidden: true,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute(tag string) {
	version = tag
	logWelcomeBanner(version)
	if os.Getenv("SERVER_TELEMETRY_DISABLED_USAGE") != "true" {
		telemetry.Init(serviceName, "", version, "", "")
	}

	clusterID := uuid.New()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	metricsRelay := metrics.InitRelay(clusterID, nil)
	if metricsRelay != nil {
		metrics.InitReplay(true)
		interval := metricsRelay.Timeout
		trigger := metrics.TickerTrigger{
			Ticker: time.NewTicker(interval),
		}
		metricsRelay.Run(ctx, trigger, metrics.Registry)
		defer metricsRelay.Stop()
	}

	err := rootCmd.Execute()
	if err != nil {
		fmt.Fprintln(os.Stderr, au.Index(1, fmt.Sprintf("Error: %v", err)).String())
		os.Exit(1)
	}
}

func init() {}
