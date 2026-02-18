import { Module } from '@nestjs/common'
import { ContainersModule } from './containers/containers.module'
import { HealthModule } from './health/health.module'

@Module({
	imports: [HealthModule, ContainersModule],
})
export class AppModule {}
