import { Controller, Get, Param, Post } from '@nestjs/common'
import { ContainersService } from './containers.service'

@Controller('containers')
export class ContainersController {
	constructor(private readonly containersService: ContainersService) {}

	@Get()
	getContainers() {
		return this.containersService.listContainers()
	}

	@Post(':id/start')
	startContainer(@Param('id') id: string) {
		return this.containersService.startContainer(id)
	}

	@Post(':id/stop')
	stopContainer(@Param('id') id: string) {
		return this.containersService.stopContainer(id)
	}

	@Post(':id/restart')
	restartContainer(@Param('id') id: string) {
		return this.containersService.restartContainer(id)
	}
}
