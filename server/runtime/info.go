package runtime

import (
	"fmt"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/mem"
	"math"
)

type Info struct {
	CPUInfoInstances int
	CPUCores         int
	CPUModelName     string
	CPUModel         string
	CPUFamily        string
	CPUVendor        string

	RAMTotalGB float64
	RAMFreeGB  float64
	RAMUsage   string
}

func GetInfo() *Info {
	info := &Info{}
	v, _ := mem.VirtualMemory()
	if v != nil {
		info.RAMTotalGB = math.Round(float64(v.Total) / 1024 / 1024 / 1024)
		info.RAMFreeGB = math.Round(float64(v.Free) / 1024 / 1024 / 1024)
		info.RAMUsage = fmt.Sprintf("%.2f%%", v.UsedPercent)
	}

	cpuInfo, _ := cpu.Info()
	if len(cpuInfo) > 0 {
		data := cpuInfo[0]
		cores := len(cpuInfo) * int(data.Cores)
		info.CPUInfoInstances = len(cpuInfo)
		info.CPUCores = cores
		info.CPUModelName = data.ModelName
		info.CPUModel = data.Model
		info.CPUFamily = data.Family
		info.CPUVendor = data.VendorID
	}

	return info
}
