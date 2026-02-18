import { BadGatewayException, Injectable } from '@nestjs/common'
import * as os from 'os'
import { HostStatsDto } from './host-stats.dto'

@Injectable()
export class StatsService {
	private sumCpuTimes(cpus: os.CpuInfo[]) {
		let idle = 0
		let total = 0

		for (const cpu of cpus) {
			const times = cpu.times
			idle += times.idle
			total += times.user + times.nice + times.sys + times.idle + times.irq
		}

		return { idle, total }
	}

	private async getCpuPercent(): Promise<number> {
		const first = this.sumCpuTimes(os.cpus())
		await new Promise(resolve => setTimeout(resolve, 500))
		const second = this.sumCpuTimes(os.cpus())

		const idleDiff = second.idle - first.idle
		const totalDiff = second.total - first.total

		if (totalDiff <= 0) {
			return 0
		}

		const cpuPercent = 100 - (idleDiff / totalDiff) * 100
		return Math.round(cpuPercent * 10) / 10
	}

	async getHostStats(): Promise<HostStatsDto> {
		try {
			const totalMemBytes = os.totalmem()
			const freeMemBytes = os.freemem()
			const usedMemBytes = Math.max(totalMemBytes - freeMemBytes, 0)
			const usedMemPercent =
				totalMemBytes > 0 ? (usedMemBytes / totalMemBytes) * 100 : 0
			const uptimeSeconds = os.uptime()
			const cpuPercent = await this.getCpuPercent()

			return {
				cpuPercent,
				totalMemBytes,
				freeMemBytes,
				usedMemBytes,
				usedMemPercent,
				uptimeSeconds,
			}
		} catch (error) {
			throw new BadGatewayException(
				error instanceof Error ? error.message : 'Host stats unavailable',
			)
		}
	}
}
