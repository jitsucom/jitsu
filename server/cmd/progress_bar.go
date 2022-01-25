package cmd

import (
	"io"
	"path/filepath"

	au "github.com/logrusorgru/aurora"
	"github.com/vbauerster/mpb/v7"
	"github.com/vbauerster/mpb/v7/decor"
)

const (
	mpbType   = "mpb"
	dummyType = "dummy"
)

type ProgressBar interface {
	SetCurrent(current int64)
	SetErrorState()

	createKBFileBar(filePath string, fileSize int64) ProgressBar
	createPartFileBar(filePath string, fileSize int64) ProgressBar

	ProxyReader(r io.Reader) io.ReadCloser

	Type() string
	Wait()
}

type DummyProgressBar struct {
}

func (d *DummyProgressBar) SetCurrent(current int64) {}

func (d *DummyProgressBar) SetErrorState() {}

//createKBFileBar returns dummy progress bar
func (d *DummyProgressBar) createKBFileBar(filePath string, fileSize int64) ProgressBar {
	return &DummyProgressBar{}
}

//createPartFileBar returns dummy progress bar
func (d *DummyProgressBar) createPartFileBar(filePath string, fileSize int64) ProgressBar {
	return &DummyProgressBar{}
}

func (d *DummyProgressBar) ProxyReader(r io.Reader) io.ReadCloser { return nil }

func (d *DummyProgressBar) Type() string { return dummyType }

func (d *DummyProgressBar) Wait() {}

type MultiProgressBar struct {
	progress *mpb.Progress
	bar      *mpb.Bar
}

func NewParentMultiProgressBar(capacity int64) *MultiProgressBar {
	progress := mpb.New()
	bar := createProcessingBar(progress, capacity)
	return &MultiProgressBar{progress: progress, bar: bar}
}

func (mp *MultiProgressBar) SetCurrent(current int64) {
	mp.bar.SetCurrent(current)
}

func (mp *MultiProgressBar) SetErrorState() {
	mp.bar.Abort(false)
}

func (mp *MultiProgressBar) Wait() {
	mp.progress.Wait()
}

//createKBFileBar creates progress bar per file which counts parts
func (mp *MultiProgressBar) createKBFileBar(filePath string, fileSize int64) ProgressBar {
	fileBar := mp.progress.Add(fileSize,
		nil,
		mpb.BarExtender(
			newLineBarFiller(
				mpb.NewBarFiller(
					mpb.BarStyle().Lbound("╢").
						Filler(au.Index(99, "█").String()).Tip("").
						Padding(au.Index(104, "░").String()).Rbound("╟")))),
		mpb.BarFillerClearOnComplete(),
		mpb.PrependDecorators(
			decor.Name(filepath.Base(filePath)),
			decor.Percentage(decor.WCSyncSpace),
		),
		mpb.AppendDecorators(
			decor.CountersKiloByte("%d / %d", decor.WCSyncWidth),
			decor.OnComplete(
				decor.Name("", decor.WCSyncWidth),
				au.Green(" ✓ done").String(),
			),
			decor.OnAbort(
				decor.Name("", decor.WCSyncWidth),
				au.Red(" ! error").String(),
			),
		),
	)
	return &MultiProgressBar{progress: mp.progress, bar: fileBar}
}

//createPartFileBar creates progress bar per file which counts parts
func (mp *MultiProgressBar) createPartFileBar(filePath string, fileSize int64) ProgressBar {
	fileBar := mp.progress.Add(fileSize,
		nil,
		mpb.BarExtender(
			newLineBarFiller(
				mpb.NewBarFiller(
					mpb.BarStyle().Lbound("╢").
						Filler(au.Index(99, "█").String()).Tip("").
						Padding(au.Index(104, "░").String()).Rbound("╟")))),
		mpb.BarFillerClearOnComplete(),
		mpb.PrependDecorators(
			decor.Name(filepath.Base(filePath)),
			decor.Percentage(decor.WCSyncSpace),
		),
		mpb.AppendDecorators(
			decor.CountersNoUnit("%d / %d parts", decor.WCSyncWidth),
			decor.OnComplete(
				decor.Name("", decor.WCSyncWidth),
				au.Green(" ✓ done").String(),
			),
			decor.OnAbort(
				decor.Name("", decor.WCSyncWidth),
				au.Red(" ! error").String(),
			),
		),
	)
	return &MultiProgressBar{progress: mp.progress, bar: fileBar}
}

func newLineBarFiller(filler mpb.BarFiller) mpb.BarFiller {
	return mpb.BarFillerFunc(func(w io.Writer, reqWidth int, st decor.Statistics) {
		if !st.Completed && !st.Aborted {
			filler.Fill(w, reqWidth, st)
			w.Write([]byte("\n"))
		}
	})
}

func (mp *MultiProgressBar) ProxyReader(r io.Reader) io.ReadCloser {
	return mp.bar.ProxyReader(r)
}

func (mp *MultiProgressBar) Type() string {
	return mpbType
}

//check all available colors:
//for i:=0;i<255;i++{
//		fmt.Println(i, " --- ", au.Index(uint8(i), "████████████████").String())
//	}
//createProcessingBar creates global progress bar
func createProcessingBar(p *mpb.Progress, allFilesSize int64) *mpb.Bar {
	return p.Add(allFilesSize,
		nil,
		mpb.BarExtender(
			newLineBarFiller(
				mpb.NewBarFiller(
					mpb.BarStyle().Lbound("╢").
						Filler(au.Index(93, "█").String()).Tip("").
						Padding(au.Index(99, "░").String()).Rbound("╟")))),
		mpb.PrependDecorators(
			decor.Name("replay"),
			decor.Percentage(decor.WCSyncSpace),
		),
		mpb.AppendDecorators(
			decor.CountersNoUnit("%d / %d files", decor.WCSyncWidth),
			decor.OnComplete(
				decor.Name("", decor.WCSyncWidth),
				au.Green(" ✓ done").String(),
			),
			decor.OnAbort(
				decor.Name("", decor.WCSyncWidth),
				au.Red(" ! error").String(),
			),
		),
		mpb.BarPriority(9999999),
	)
}
