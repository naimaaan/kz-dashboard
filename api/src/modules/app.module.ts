import { Module } from '@nestjs/common'
import { ContainersModule } from './containers/containers.module'
import { ExploitsModule } from './exploits/exploits.module'
import { HealthModule } from './health/health.module'
import { ServicesModule } from './services/services.module'
import { StatsModule } from './stats/stats.module'

@Module({
	imports: [
		HealthModule,
		ContainersModule,
		ServicesModule,
		ExploitsModule,
		StatsModule,
	],
})
export class AppModule {}
