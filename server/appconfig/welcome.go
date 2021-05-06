package appconfig

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/jitsucom/jitsu/server/logging"
	"golang.org/x/term"
)

const (
	// In real life situations we'd adjust the document to fit the width we've
	// detected. In the case of this example we're hardcoding the width, and
	// later using the detected width only to truncate in order to avoid jaggy
	// wrapping.
	width       = 96
	columnWidth = 30
)

var (
	subtle = lipgloss.AdaptiveColor{Light: "#D9DCCF", Dark: "#383838"}

	list = lipgloss.NewStyle().
		Border(lipgloss.NormalBorder(), false, true, false, false).
		BorderForeground(subtle).
		MarginRight(2).
		Height(8).
		Width(columnWidth + 1)

	listHeader = lipgloss.NewStyle().
			BorderStyle(lipgloss.NormalBorder()).
			BorderBottom(true).
			BorderForeground(subtle).
			MarginRight(2).
			Render

	docStyle = lipgloss.NewStyle().Padding(1, 2, 1, 2)

	dialogBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("#5a41f5")).
			Padding(1, 0).
			BorderTop(true).
			BorderLeft(true).
			BorderRight(true).
			BorderBottom(true)
)

func logWelcomeBanner(version string) {
	physicalWidth, _, _ := term.GetSize(int(os.Stdout.Fd()))
	doc := strings.Builder{}

	styler := lipgloss.NewStyle().Width(80).Align(lipgloss.Center)

	welcome := styler.Render(fmt.Sprintf("Welcome to Jitsu Server %s!", version))
	description := styler.Render("🚀 Jitsu is an open-source data collection platform")

	lists := lipgloss.JoinHorizontal(lipgloss.Top,
		list.Render(
			lipgloss.JoinVertical(lipgloss.Left,
				listHeader("📚 Documentation:"),
				listHeader("🌎 Website:"),
				listHeader("🌟 Github:"),
				listHeader("💪 Follow us on twitter:"),
				listHeader("💬 Join our Slack:"),
			),
		),
		list.Copy().Width(columnWidth).Border(lipgloss.NormalBorder(), false, false, false, false).Render(
			lipgloss.JoinVertical(lipgloss.Left,
				listHeader("https://jitsu.com/docs"),
				listHeader("https://jitsu.com"),
				listHeader("https://github.com/jitsucom/jitsu"),
				listHeader("https://twitter.com/jitsucom"),
				listHeader("https://jitsu.com/slack"),
			),
		),
	)

	ui := lipgloss.JoinVertical(lipgloss.Center, welcome, " ", description, " ", lists)

	dialog := lipgloss.Place(width, 17,
		lipgloss.Center, lipgloss.Center,
		dialogBoxStyle.Render(ui),
		//lipgloss.WithWhitespaceChars("柔术"),
		lipgloss.WithWhitespaceForeground(subtle),
	)

	doc.WriteString(dialog + "\n")

	if physicalWidth > 0 {
		docStyle = docStyle.MaxWidth(physicalWidth)
	}

	// Okay, let's print it
	logging.Info(docStyle.Render(doc.String()))
}

func logDeprecatedImageUsage(dockerHubID string) {
	//check usage of deprecated image
	if strings.TrimSpace(dockerHubID) == "ksense" {
		logging.Warnf("\n\n\t *** ksense/eventnative docker image is DEPRECATED. Please use jitsucom/server. For more details read https://jitsu.com/docs/deployment/deploy-with-docker ***\n")
	}
}
