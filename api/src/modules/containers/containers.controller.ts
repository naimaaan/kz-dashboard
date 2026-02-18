import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { BulkActionDto } from './bulk-action.dto'
import { ContainersService } from './containers.service'

@Controller('containers')
export class ContainersController {
	constructor(private readonly containersService: ContainersService) {}

	@Get()
	getContainers() {
		return this.containersService.listContainers()
	}

	@Post('bulk/start')
	bulkStart(@Body() input: BulkActionDto) {
		return this.containersService.bulkStart(input)
	}

	@Post('bulk/stop')
	bulkStop(@Body() input: BulkActionDto) {
		return this.containersService.bulkStop(input)
	}

	@Post('bulk/restart')
	bulkRestart(@Body() input: BulkActionDto) {
		return this.containersService.bulkRestart(input)
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

	@Get(':id/stats')
	getContainerStats(@Param('id') id: string) {
		return this.containersService.getContainerStats(id)
	}

	@Get(':id/logs')
	async getContainerLogs(
		@Param('id') id: string,
		@Query('tail') tail?: string,
	) {
		const parsedTail = tail ? Number.parseInt(tail, 10) : 200
		const text = await this.containersService.getContainerLogs(id, parsedTail)
		return { text }
	}
}
