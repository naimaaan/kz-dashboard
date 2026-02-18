import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common'
import * as Docker from 'dockerode'
import { ContainerDto } from './container.dto'
import { ContainerStatsDto } from './container-stats.dto'
import {
	BulkActionDto,
	BulkActionFailureDto,
	BulkActionResultDto,
} from './bulk-action.dto'

const isWin = process.platform === 'win32'

const docker = isWin
	? new Docker({ socketPath: '//./pipe/docker_engine' })
	: new Docker({ socketPath: '/var/run/docker.sock' })

const DEFAULT_PROTECTED_CONTAINERS = [
	'kz-dashboard-api',
	'kz-dashboard-web',
	'docker',
	'containerd',
]

const configuredProtectedContainers =
	process.env.PROTECTED_CONTAINERS?.split(',')
		.map(value => value.trim().toLowerCase())
		.filter(value => value.length > 0) ?? []

const protectedContainers = new Set(
	configuredProtectedContainers.length > 0
		? configuredProtectedContainers
		: DEFAULT_PROTECTED_CONTAINERS,
)

const BULK_CONCURRENCY = 5

type BulkAction = 'start' | 'stop' | 'restart'

interface DockerContainerSummary {
	Id: string
	Names?: string[]
	Image: string
	State: string
	Status: string
}

interface DockerStatsSnapshot {
	cpu_stats?: {
		cpu_usage?: {
			total_usage?: number
			percpu_usage?: number[]
		}
		system_cpu_usage?: number
		online_cpus?: number
	}
	precpu_stats?: {
		cpu_usage?: {
			total_usage?: number
		}
		system_cpu_usage?: number
	}
	memory_stats?: {
		usage?: number
		limit?: number
	}
	pids_stats?: {
		current?: number
	}
}

@Injectable()
export class ContainersService {
	private readonly docker = docker

	async listContainers(): Promise<ContainerDto[]> {
		try {
			const containers = await this.docker.listContainers({ all: true })
			return containers.map(container => this.toContainerDto(container))
		} catch (error) {
			console.error('Docker unavailable:', error)
			return []
		}
	}

	async startContainer(id: string): Promise<{ id: string; action: 'start' }> {
		const container = this.docker.getContainer(id)
		await this.assertExists(id)
		await container.start()
		return { id, action: 'start' }
	}

	async stopContainer(id: string): Promise<{ id: string; action: 'stop' }> {
		const container = this.docker.getContainer(id)
		await this.assertExists(id)
		await container.stop()
		return { id, action: 'stop' }
	}

	async restartContainer(
		id: string,
	): Promise<{ id: string; action: 'restart' }> {
		const container = this.docker.getContainer(id)
		await this.assertExists(id)
		await container.restart()
		return { id, action: 'restart' }
	}

	async getContainerStats(id: string): Promise<ContainerStatsDto> {
		try {
			const container = this.docker.getContainer(id)
			const stats = (await container.stats({
				stream: false,
			})) as DockerStatsSnapshot

			return this.toContainerStatsDto(stats)
		} catch (error) {
			throw new BadGatewayException(
				error instanceof Error ? error.message : 'Container stats unavailable',
			)
		}
	}

	async bulkStart(input: BulkActionDto): Promise<BulkActionResultDto> {
		return this.executeBulkAction('start', input)
	}

	async bulkStop(input: BulkActionDto): Promise<BulkActionResultDto> {
		return this.executeBulkAction('stop', input)
	}

	async bulkRestart(input: BulkActionDto): Promise<BulkActionResultDto> {
		return this.executeBulkAction('restart', input)
	}

	private toContainerDto(container: DockerContainerSummary): ContainerDto {
		return {
			id: container.Id,
			name: container.Names?.[0]?.replace(/^\//, '') ?? container.Id,
			image: container.Image,
			state: container.State,
			status: container.Status,
		}
	}

	private toContainerStatsDto(stats: DockerStatsSnapshot): ContainerStatsDto {
		const cpuUsage = stats.cpu_stats?.cpu_usage?.total_usage ?? 0
		const prevCpuUsage = stats.precpu_stats?.cpu_usage?.total_usage ?? 0
		const cpuDelta = cpuUsage - prevCpuUsage

		const systemCpuUsage = stats.cpu_stats?.system_cpu_usage ?? 0
		const prevSystemCpuUsage = stats.precpu_stats?.system_cpu_usage ?? 0
		const systemDelta = systemCpuUsage - prevSystemCpuUsage

		const onlineCpus =
			stats.cpu_stats?.online_cpus ??
			stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
			1

		const cpuPercent =
			cpuDelta > 0 && systemDelta > 0
				? (cpuDelta / systemDelta) * onlineCpus * 100
				: 0

		const memUsageBytes = stats.memory_stats?.usage ?? 0
		const memLimitBytes = stats.memory_stats?.limit ?? 0
		const memPercent =
			memUsageBytes > 0 && memLimitBytes > 0
				? (memUsageBytes / memLimitBytes) * 100
				: 0

		return {
			cpuPercent,
			memUsageBytes,
			memLimitBytes,
			memPercent,
			pids: stats.pids_stats?.current ?? null,
		}
	}

	private async executeBulkAction(
		action: BulkAction,
		input: BulkActionDto,
	): Promise<BulkActionResultDto> {
		const allContainers = await this.listContainerSummaries()
		const targets = this.resolveBulkTargets(allContainers, input)

		const failed: BulkActionFailureDto[] = []
		const succeeded: string[] = []

		await this.runWithConcurrency(targets, BULK_CONCURRENCY, async target => {
			try {
				await this.applyContainerAction(target.Id, action)
				succeeded.push(target.Id)
			} catch (error) {
				failed.push({
					id: target.Id,
					name: this.getContainerName(target),
					error: error instanceof Error ? error.message : 'Unknown error',
				})
			}
		})

		return {
			ok: true,
			total: targets.length,
			succeeded,
			failed,
		}
	}

	private async listContainerSummaries(): Promise<DockerContainerSummary[]> {
		try {
			return await this.docker.listContainers({ all: true })
		} catch (error) {
			console.error('Docker unavailable:', error)
			return []
		}
	}

	private resolveBulkTargets(
		allContainers: DockerContainerSummary[],
		input: BulkActionDto,
	): DockerContainerSummary[] {
		const ids = new Set((input.ids ?? []).map(value => value.trim()))
		const names = new Set(
			(input.names ?? []).map(value => value.trim().toLowerCase()),
		)

		const selected = allContainers.filter(container => {
			if (input.includeAll) {
				return true
			}

			const name = this.getContainerName(container).toLowerCase()
			return ids.has(container.Id) || names.has(name)
		})

		return selected.filter(
			container =>
				!protectedContainers.has(
					this.getContainerName(container).toLowerCase(),
				),
		)
	}

	private async applyContainerAction(
		id: string,
		action: BulkAction,
	): Promise<void> {
		const container = this.docker.getContainer(id)
		if (action === 'start') {
			await container.start()
			return
		}

		if (action === 'stop') {
			await container.stop()
			return
		}

		await container.restart()
	}

	private getContainerName(container: DockerContainerSummary): string {
		return container.Names?.[0]?.replace(/^\//, '') ?? container.Id
	}

	private async runWithConcurrency<T>(
		items: T[],
		concurrency: number,
		handler: (item: T) => Promise<void>,
	): Promise<void> {
		let cursor = 0

		const workers = Array.from(
			{ length: Math.min(concurrency, items.length) },
			async () => {
				while (cursor < items.length) {
					const item = items[cursor]
					cursor += 1
					await handler(item)
				}
			},
		)

		await Promise.all(workers)
	}

	private async assertExists(id: string): Promise<void> {
		try {
			await this.docker.getContainer(id).inspect()
		} catch {
			throw new NotFoundException(`Container not found: ${id}`)
		}
	}
}
