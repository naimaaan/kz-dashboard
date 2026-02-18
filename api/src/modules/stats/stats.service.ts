import { BadGatewayException, Injectable } from '@nestjs/common'
import * as os from 'os'
import { HostStatsDto } from './host-stats.dto'

@Injectable()
export class StatsService {
	getHostStats(): HostStatsDto {
		try {
			const totalMemBytes = os.totalmem()
			const freeMemBytes = os.freemem()
			const usedMemBytes = Math.max(totalMemBytes - freeMemBytes, 0)
			const usedMemPercent =
				totalMemBytes > 0 ? (usedMemBytes / totalMemBytes) * 100 : 0
			const uptimeSeconds = os.uptime()

			const cpuLoad =
				process.platform === 'win32' ? null : (os.loadavg()[0] ?? null)

			return {
				cpuLoad,
				cpuLoadNote: cpuLoad === null ? 'N/A on Windows' : undefined,
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
