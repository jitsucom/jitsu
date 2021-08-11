package cmd

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	au "github.com/logrusorgru/aurora"
	"github.com/spf13/cobra"
	"github.com/vbauerster/mpb/v7"
	"github.com/vbauerster/mpb/v7/decor"
	"io"
	"io/fs"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const (
	maxChunkSize = 20 * 1024 * 1024 // 20 MB
	dateLayout   = "2006-01-02"
)

var (
	//command flags
	state, start, end, host, apiKey string
	chunkSize                       int64
	//command args
	files []string
)

// replayCmd represents the base command when called without any subcommands
var replayCmd = &cobra.Command{
	Use:   "replay [flags] <files>",
	Short: "CLI for uploading data from local files into Jitsu destinations via API",
	Long:  `Jitsu CLI tool for bulk uploading files with events into Jitsu. Common use case: upload archive logs (aka replay)`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			return errors.New("requires at least 1 file as an arg")
		}
		return replay(args)
	},
	Version: "0.0.1",
}

func init() {
	rootCmd.AddCommand(replayCmd)

	replayCmd.Flags().StringVar(&state, "state", "", "a path to file where Jitsu will save the state (files already uploaded)")
	replayCmd.Flags().StringVar(&start, "start", "", "start date as YYYY-MM-DD. Treated as the beginning of the day UTC (YYYY-MM-DD 00:00:00.000Z). Optional. If missing, all files will be processed")
	replayCmd.Flags().StringVar(&end, "end", "", "end date as YYYY-MM-DD. Treated as the end of the day UTC (YYYY-MM-DD 23:59:59.999Z). Optional. If missing, all will be processed")
	replayCmd.Flags().StringVar(&host, "host", "http://localhost:8000", "Jitsu host")
	replayCmd.Flags().Int64Var(&chunkSize, "chunk_size", maxChunkSize, "max data chunk size in bytes (default 20 MB). If file size is greater then the file will be split into N chunks with max size and sent to Jitsu")

	replayCmd.Flags().StringVar(&apiKey, "api_key", "", "(required) Jitsu API Key. Data will be loaded into all destinations linked to this API Key.")
	replayCmd.MarkFlagRequired("api_key")
}

//replay is a command main function:
//read files from filesystem and sends them to Jitsu
//operating:
// 1. always with full path filenames
// 2. always sends gzipped payloads to Jitsu
//returns err if occurred
func replay(inputFiles []string) error {
	absoluteFileNames, err := reformatFileNames(inputFiles)
	if err != nil {
		return fmt.Errorf("preprocessing files failed: %v", err)
	}

	absoluteFileNamesAfterFiltering, err := filterFiles(absoluteFileNames, start, end)
	if err != nil {
		if err != nil {
			return fmt.Errorf("filtering files by date failed: %v", err)
		}
	}

	if len(absoluteFileNamesAfterFiltering) == 0 {
		return errors.New("none of the files match the --start --end condition")
	}

	absStateName, err := getAbsoluteFilePath(state)
	if err != nil {
		return fmt.Errorf("failed to get absolute state file path: %v", err)
	}

	stateMap, err := readState(absStateName)
	if err != nil {
		return fmt.Errorf("failed to read state file [%s]: %v", state, err)
	}

	var filesToUpload []string
	for _, f := range absoluteFileNamesAfterFiltering {
		//filter state file
		if f == absStateName {
			continue
		}

		stored, ok := stateMap[f]
		if !ok || !stored {
			filesToUpload = append(filesToUpload, f)
		}
	}

	if len(filesToUpload) == 0 {
		return errors.New("all files are marked as uploaded in state. Nothing to replay.")
	}

	capacity := int64(len(filesToUpload))
	progressBars := mpb.New()
	globalBar := createProcessingBar(progressBars, capacity)

	client := newBulkClient(host, apiKey)

	var processedFiles int64
	for _, absFilePath := range filesToUpload {
		fileStat, err := os.Stat(absFilePath)
		if err != nil {
			return err
		}

		if err := uploadFile(progressBars, client, absFilePath, fileStat.Size()); err != nil {
			return fmt.Errorf("uploading file: %s\nmessage: %v", absFilePath, err)
		}
		processedFiles++
		globalBar.SetCurrent(processedFiles)
		stateMap[absFilePath] = true
		//write state after every loaded file
		if err := writeState(state, stateMap); err != nil {
			return fmt.Errorf("Error saving state into the file [%s]: %v", state, err)
		}
	}

	globalBar.SetCurrent(capacity)
	//wait for globalBar filled
	time.Sleep(time.Second)

	return nil
}

//uploadFile divides input file into chunks if size is grater then chunkSize
//sends data to Jitsu
//returns err if occurred
func uploadFile(progressBars *mpb.Progress, client *bulkClient, filePath string, fileSize int64) error {
	if fileSize > chunkSize {
		return sendChunked(progressBars, filePath, fileSize, client.sendGzippedMultiPart)
	}

	//send the whole file
	payload, err := ioutil.ReadFile(filePath)
	if err != nil {
		return err
	}

	if filepath.Ext(filePath) != ".gz" {
		payload, err = doGzip(payload)
		if err != nil {
			return err
		}
	}

	//payload size of already gzipped
	payloadSize := int64(len(payload))
	processingTime := int64(float64(payloadSize) * 0.1)
	capacity := payloadSize + processingTime
	fileProgressBar := createKBFileBar(progressBars, filePath, capacity)

	if err := client.sendGzippedMultiPart(fileProgressBar, filePath, payload); err != nil {
		return err
	}

	fileProgressBar.SetCurrent(capacity)
	return nil
}

//sendChunked reads file maxChunkSize bytes and sends each chunk separately
func sendChunked(progressBars *mpb.Progress, filePath string, fileSize int64, sender func(fileProgressBar *mpb.Bar, filePath string, payload []byte) error) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	capacity := fileSize/chunkSize + 1
	var scanner *bufio.Scanner
	if filepath.Ext(filePath) == ".gz" {
		content, err := gzip.NewReader(file)
		if err != nil {
			return err
		}
		scanner = bufio.NewScanner(content)
	} else {
		scanner = bufio.NewScanner(file)
	}

	fileProgressBar := createPartFileBar(progressBars, filePath, capacity)

	cbuffer := make([]byte, 0, bufio.MaxScanTokenSize)
	scanner.Buffer(cbuffer, bufio.MaxScanTokenSize*100)

	chunk := bytes.Buffer{}
	var progress int64
	for scanner.Scan() {
		line := scanner.Bytes()
		if int64(chunk.Len()) > chunkSize {
			gzipped, err := doGzip(chunk.Bytes())
			if err != nil {
				return err
			}

			if err := sender(nil, filePath, gzipped); err != nil {
				return err
			}
			progress++
			fileProgressBar.SetCurrent(progress)
			chunk.Reset()
		}

		if chunk.Len() > 0 {
			chunk.Write([]byte("\n"))
		}

		if _, err := chunk.Write(line); err != nil {
			return err
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	if chunk.Len() > 0 {
		//send
		gzipped, err := doGzip(chunk.Bytes())
		if err != nil {
			return err
		}

		if err := sender(nil, filePath, gzipped); err != nil {
			return err
		}
	}

	fileProgressBar.SetCurrent(capacity)

	return nil
}

func getAbsoluteFilePath(file string) (string, error) {
	if file == "" {
		return "", nil
	}

	if filepath.IsAbs(file) {
		return file, nil
	}

	app, err := os.Executable()
	if err != nil {
		return "", err
	}

	appDir := filepath.Dir(app)

	return filepath.Join(appDir, file), nil
}

//readState returns state which contains already uploaded file names
//returns empty map if file isn't provided
func readState(file string) (map[string]bool, error) {
	if file == "" {
		return map[string]bool{}, nil
	}

	b, err := ioutil.ReadFile(file)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]bool{}, nil
		}

		return nil, err
	}

	stateMap := map[string]bool{}
	if err := json.Unmarshal(b, &stateMap); err != nil {
		return nil, err
	}

	return stateMap, nil
}

//writeState overwrites state file with updated values
func writeState(file string, stateMap map[string]bool) error {
	if file == "" {
		return nil
	}

	b, err := json.Marshal(stateMap)
	if err != nil {
		return err
	}

	return ioutil.WriteFile(file, b, 0644)
}

//reformatFileNames returns files list with absolute path
//All directories in the list will be read recursively
func reformatFileNames(files []string) ([]string, error) {
	app, err := os.Executable()
	if err != nil {
		return nil, err
	}

	appDir := filepath.Dir(app)

	var result []string
	for _, f := range files {
		if !filepath.IsAbs(f) {
			f = filepath.Join(appDir, f)
		}

		if err := filepath.Walk(f,
			func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if !info.IsDir() {
					result = append(result, path)
				}

				return nil
			}); err != nil {
			return nil, err
		}
	}

	return result, nil
}

//filterFiles filters files by date and returns
func filterFiles(absoluteFileNames []string, startStr string, endStr string) ([]string, error) {
	if startStr == "" && endStr == "" {
		return absoluteFileNames, nil
	}

	startDate := time.Time{}
	if startStr != "" {
		t, err := time.Parse(dateLayout, startStr)
		if err != nil {
			return nil, fmt.Errorf("error parsing 'start': %v", err)
		}
		startDate = t
	}

	endDate := time.Now().UTC()
	if endStr != "" {
		t, err := time.Parse(dateLayout, endStr)
		if err != nil {
			return nil, fmt.Errorf("error parsing 'end': %v", err)
		}
		endDate = t.Add(time.Hour*23 + time.Minute*59 + time.Second*59 + time.Millisecond*999)
	}

	var result []string
	re := regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)
	for _, fn := range absoluteFileNames {
		filename := filepath.Base(fn)
		if re.MatchString(filename) {
			submatchall := re.FindAllString(filename, -1)
			for _, submatch := range submatchall {
				fileTime, err := time.Parse(dateLayout, submatch)
				if err != nil {
					return nil, fmt.Errorf("error parsing filename's [%s] date: %v", filename, err)
				}
				if startDate.Before(fileTime) && endDate.After(fileTime) {
					result = append(result, fn)
					break
				}
			}
		} else {
			fmt.Println(fmt.Sprintf("file %s doesn't contain date in its name. The file will be ignored.", fn))
		}
	}

	return result, nil
}

//doGzip returns gzipped payload
func doGzip(payload []byte) ([]byte, error) {
	gzipped := bytes.Buffer{}
	gzw := gzip.NewWriter(&gzipped)
	if _, err := io.Copy(gzw, bytes.NewBuffer(payload)); err != nil {
		return nil, err
	}

	if err := gzw.Close(); err != nil {
		return nil, err
	}

	return gzipped.Bytes(), nil
}

//check all available colors:
//for i:=0;i<255;i++{
//		fmt.Println(i, " --- ", au.Index(uint8(i), "████████████████").String())
//	}
//createProcessingBar creates global progress bar
func createProcessingBar(p *mpb.Progress, allFilesSize int64) *mpb.Bar {
	return p.Add(allFilesSize,
		mpb.NewBarFiller(mpb.BarStyle().Lbound("╢").Filler(au.Index(93, "█").String()).Tip("").Padding(au.Index(99, "░").String()).Rbound("╟")),
		mpb.PrependDecorators(
			decor.Name("replay"),
			decor.Percentage(decor.WCSyncSpace),
		),
		mpb.AppendDecorators(
			decor.OnComplete(
				decor.CountersNoUnit("%d / %d files", decor.WCSyncWidth), au.Green("✓ done").String(),
			),
		),
		mpb.BarPriority(9999999),
	)
}

//createKBFileBar creates progress bar per file which counts parts
func createKBFileBar(p *mpb.Progress, filePath string, fileSize int64) *mpb.Bar {
	return p.Add(fileSize,
		mpb.NewBarFiller(mpb.BarStyle().Lbound("╢").Filler(au.Index(99, "█").String()).Tip("").Padding(au.Index(104, "░").String()).Rbound("╟")),
		mpb.PrependDecorators(
			decor.Name(filepath.Base(filePath)),
			decor.Percentage(decor.WCSyncSpace),
		),
		mpb.AppendDecorators(
			decor.OnComplete(
				decor.CountersKiloByte("%d / %d", decor.WCSyncWidth), au.Green("✓ done").String(),
			),
		),
	)
}

//createPartFileBar creates progress bar per file which counts parts
func createPartFileBar(p *mpb.Progress, filePath string, fileSize int64) *mpb.Bar {
	return p.Add(fileSize,
		mpb.NewBarFiller(mpb.BarStyle().Lbound("╢").Filler(au.Index(99, "█").String()).Tip("").Padding(au.Index(104, "░").String()).Rbound("╟")),
		mpb.PrependDecorators(
			decor.Name(filepath.Base(filePath)),
			decor.Percentage(decor.WCSyncSpace),
		),
		mpb.AppendDecorators(
			decor.OnComplete(
				decor.CountersNoUnit("%d / %d parts", decor.WCSyncWidth), au.Green("✓ done").String(),
			),
		),
	)
}
