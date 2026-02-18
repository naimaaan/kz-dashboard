import { Module } from '@nestjs/common'
import { ClustersController } from './clusters.controller'
import { ContainersController } from './containers.controller'
import { ContainersService } from './containers.service'

@Module({
	controllers: [ContainersController, ClustersController],
	providers: [ContainersService],
})
export class ContainersModule {}
