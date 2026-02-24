import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { ServicesService } from './services.service'
import { SwitchProfileDto } from './switch-profile.dto'

@Controller('services')
export class ServicesController {
	constructor(private readonly servicesService: ServicesService) {}

	@Get()
	listServices() {
		return this.servicesService.listServices()
	}

	@Get(':name')
	getService(@Param('name') name: string) {
		return this.servicesService.getService(name)
	}

	// Legacy profile endpoints (custom services)
	@Put(':name/profile')
	switchProfile(
		@Param('name') name: string,
		@Body() body: SwitchProfileDto,
	) {
		return this.servicesService.switchProfile(name, body.profile)
	}

	@Post(':name/reset')
	resetService(@Param('name') name: string) {
		return this.servicesService.resetService(name)
	}

	@Post('reset-all')
	resetAll() {
		return this.servicesService.resetAll()
	}

	// Deploy endpoints (Vulhub / Docker Hub services)
	@Post(':name/deploy')
	deployService(@Param('name') name: string) {
		return this.servicesService.deployService(name)
	}

	@Post(':name/undeploy')
	undeployService(@Param('name') name: string) {
		return this.servicesService.undeployService(name)
	}

	@Post('undeploy-all')
	undeployAll() {
		return this.servicesService.undeployAll()
	}
}
