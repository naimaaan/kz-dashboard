import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import * as Docker from 'dockerode'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { ServiceDto, ServiceProfileDto } from './service.dto'

const isWin = process.platform === 'win32'

const docker = isWin
	? new Docker({ socketPath: '//./pipe/docker_engine' })
	: new Docker({ socketPath: '/var/run/docker.sock' })

interface YamlProfile {
	image: string
	label: string
	cves: string[]
}

interface YamlServiceEntry {
	display_name: string
	description: string
	container_name: string
	network: string
	ports: string[]
	env: Record<string, string>
	profiles: Record<string, YamlProfile>
	active_profile: string
}

interface YamlConfig {
	services: Record<string, YamlServiceEntry>
}

@Injectable()
export class ServicesService {
	private readonly configPath: string

	constructor() {
		this.configPath =
			process.env.SERVICES_CONFIG_PATH ??
			path.resolve(process.cwd(), 'config', 'services.yml')
	}

	async listServices(): Promise<ServiceDto[]> {
		const config = this.readConfig()
		const containers = await this.listRunningContainers()

		return Object.entries(config.services).map(([name, entry]) =>
			this.toServiceDto(name, entry, containers),
		)
	}

	async getService(name: string): Promise<ServiceDto> {
		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) {
			throw new NotFoundException(`Service not found: ${name}`)
		}

		const containers = await this.listRunningContainers()
		return this.toServiceDto(name, entry, containers)
	}

	async switchProfile(
		name: string,
		profile: string,
	): Promise<ServiceDto> {
		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) {
			throw new NotFoundException(`Service not found: ${name}`)
		}

		if (!entry.profiles[profile]) {
			throw new BadRequestException(
				`Invalid profile "${profile}" for service "${name}". Available: ${Object.keys(entry.profiles).join(', ')}`,
			)
		}

		if (entry.active_profile === profile) {
			const containers = await this.listRunningContainers()
			return this.toServiceDto(name, entry, containers)
		}

		const targetProfile = entry.profiles[profile]

		await this.recreateContainer(entry, targetProfile.image)

		entry.active_profile = profile
		this.writeConfig(config)

		const containers = await this.listRunningContainers()
		return this.toServiceDto(name, entry, containers)
	}

	async resetService(name: string): Promise<ServiceDto> {
		return this.switchProfile(name, 'easy')
	}

	async resetAll(): Promise<ServiceDto[]> {
		const config = this.readConfig()
		const results: ServiceDto[] = []

		for (const [name, entry] of Object.entries(config.services)) {
			if (entry.active_profile !== 'easy') {
				try {
					const dto = await this.switchProfile(name, 'easy')
					results.push(dto)
				} catch (error) {
					console.error(`Failed to reset ${name}:`, error)
					const containers = await this.listRunningContainers()
					results.push(this.toServiceDto(name, entry, containers))
				}
			} else {
				const containers = await this.listRunningContainers()
				results.push(this.toServiceDto(name, entry, containers))
			}
		}

		return results
	}

	private readConfig(): YamlConfig {
		try {
			const raw = fs.readFileSync(this.configPath, 'utf8')
			return yaml.load(raw) as YamlConfig
		} catch (error) {
			throw new NotFoundException(
				`Config file not readable: ${error instanceof Error ? error.message : 'unknown error'}`,
			)
		}
	}

	private writeConfig(config: YamlConfig): void {
		const raw = yaml.dump(config, {
			lineWidth: 120,
			noRefs: true,
			quotingType: '"',
		})
		fs.writeFileSync(this.configPath, raw, 'utf8')
	}

	private async recreateContainer(
		entry: YamlServiceEntry,
		newImage: string,
	): Promise<void> {
		const containerName = entry.container_name

		try {
			const existing = docker.getContainer(containerName)
			const info = await existing.inspect()

			if (info.State.Running) {
				await existing.stop()
			}
			await existing.remove({ force: true })
		} catch {
			// container doesn't exist yet -- that's fine
		}

		try {
			await new Promise<void>((resolve, reject) => {
				docker.pull(newImage, (err: Error | null, stream: NodeJS.ReadableStream) => {
					if (err) {
						reject(err)
						return
					}
					docker.modem.followProgress(stream, (followErr: Error | null) => {
						if (followErr) {
							reject(followErr)
						} else {
							resolve()
						}
					})
				})
			})
		} catch (error) {
			console.warn(
				`Image pull failed for ${newImage}, attempting with local image:`,
				error instanceof Error ? error.message : error,
			)
		}

		const portBindings: Record<string, Array<{ HostPort: string }>> = {}
		const exposedPorts: Record<string, object> = {}

		for (const mapping of entry.ports ?? []) {
			const [hostPart, containerPort] = mapping.split(':')
			const key = `${containerPort}/tcp`
			exposedPorts[key] = {}
			portBindings[key] = [{ HostPort: hostPart }]
		}

		const envList = Object.entries(entry.env ?? {}).map(
			([k, v]) => `${k}=${v}`,
		)

		const container = await docker.createContainer({
			Image: newImage,
			name: containerName,
			Env: envList,
			ExposedPorts: exposedPorts,
			HostConfig: {
				PortBindings: portBindings,
				NetworkMode: entry.network,
				RestartPolicy: { Name: 'unless-stopped' },
			},
		})

		await container.start()
	}

	private async listRunningContainers(): Promise<
		Map<string, { id: string; running: boolean }>
	> {
		const result = new Map<string, { id: string; running: boolean }>()

		try {
			const containers = await docker.listContainers({ all: true })

			for (const c of containers) {
				const name = c.Names?.[0]?.replace(/^\//, '') ?? ''
				if (name) {
					result.set(name, {
						id: c.Id,
						running: c.State === 'running',
					})
				}
			}
		} catch (error) {
			console.error('Docker unavailable:', error)
		}

		return result
	}

	private toServiceDto(
		name: string,
		entry: YamlServiceEntry,
		containers: Map<string, { id: string; running: boolean }>,
	): ServiceDto {
		const containerInfo = containers.get(entry.container_name)

		const profiles: Record<string, ServiceProfileDto> = {}
		for (const [key, p] of Object.entries(entry.profiles)) {
			profiles[key] = {
				image: p.image,
				label: p.label,
				cves: p.cves ?? [],
			}
		}

		return {
			name,
			displayName: entry.display_name,
			description: entry.description,
			containerName: entry.container_name,
			network: entry.network,
			ports: entry.ports ?? [],
			activeProfile: entry.active_profile,
			profiles,
			running: containerInfo?.running ?? false,
			containerId: containerInfo?.id ?? null,
		}
	}
}
