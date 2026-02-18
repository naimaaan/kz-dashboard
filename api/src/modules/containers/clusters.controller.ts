import { Controller, Param, Post } from '@nestjs/common'
import { ContainersService } from './containers.service'

@Controller('clusters')
export class ClustersController {
	constructor(private readonly containersService: ContainersService) {}

	@Post(':cluster/start')
	startCluster(@Param('cluster') cluster: string) {
		return this.containersService.startCluster(cluster)
	}

	@Post(':cluster/stop')
	stopCluster(@Param('cluster') cluster: string) {
		return this.containersService.stopCluster(cluster)
	}

	@Post(':cluster/restart')
	restartCluster(@Param('cluster') cluster: string) {
		return this.containersService.restartCluster(cluster)
	}
}
