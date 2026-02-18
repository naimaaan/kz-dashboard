import { Module } from '@nestjs/common'
import { ContainersModule } from './containers/containers.module'
import { HealthModule } from './health/health.module'
import { StatsModule } from './stats/stats.module'

@Module({
	imports: [HealthModule, ContainersModule, StatsModule],
})
export class AppModule {}
