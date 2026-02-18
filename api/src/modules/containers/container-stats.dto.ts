export interface ContainerStatsDto {
	cpuPercent: number
	memUsageBytes: number
	memLimitBytes: number
	memPercent: number
	pids: number | null
}
