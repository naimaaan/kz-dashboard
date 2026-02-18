export interface HostStatsDto {
	cpuLoad: number | null
	cpuLoadNote?: string
	totalMemBytes: number
	freeMemBytes: number
	usedMemBytes: number
	usedMemPercent: number
	uptimeSeconds: number
}
