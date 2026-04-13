import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { exec } from 'child_process'
import * as Docker from 'dockerode'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import {
	ServiceDto,
	ServiceProfileDto,
	ServiceVariantDto,
	SwitchVariantResultDto,
} from './service.dto'
import { SwitchVariantDto } from './switch-variant.dto'

const isWin = process.platform === 'win32'

const docker = isWin
	? new Docker({ socketPath: '//./pipe/docker_engine' })
	: new Docker({ socketPath: '/var/run/docker.sock' })

interface YamlProfile {
	image: string
	label: string
	cves: string[]
}

interface YamlVariantHealthcheck {
	type: 'http' | 'tcp'
	path?: string
	timeout_sec?: number
}

interface YamlVariant {
	image: string
	label: string
	cves?: string[]
	healthcheck?: YamlVariantHealthcheck
}

interface YamlServiceEntry {
	display_name: string
	description: string
	category?: string
	container_name?: string
	network?: string
	ports?: string[]
	env?: Record<string, string>
	switchable?: boolean
	variant_mode?: 'image'
	variants?: Record<string, YamlVariant>
	active_variant?: string
	last_good_variant?: string
	profiles?: Record<string, YamlProfile>
	active_profile?: string
	deploy_mode?: 'compose' | 'image'
	compose_path?: string
	compose_service?: string
	host_port?: number
	container_port?: number
	image?: string
	cves?: string[]
}

interface YamlSettings {
	max_concurrent: number
	vulhub_dir: string
	protected_service_names?: string[]
}

interface YamlConfig {
	settings?: YamlSettings
	services: Record<string, YamlServiceEntry>
}

interface SwitchVariantContext {
	config: YamlConfig
	entry: YamlServiceEntry
	variants: Record<string, YamlVariant>
	target: YamlVariant
	fromVariant: string
	targetVariant: string
}

function execAsync(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		exec(cmd, { cwd, timeout: 120_000 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`))
			} else {
				resolve({ stdout, stderr })
			}
		})
	})
}

@Injectable()
export class ServicesService {
	private readonly configPath: string
	private readonly switchLocks = new Set<string>()

	constructor() {
		this.configPath =
			process.env.SERVICES_CONFIG_PATH ??
			path.resolve(process.cwd(), 'config', 'services.yml')
	}

	// ── LIST / GET ──────────────────────────────────────────

	async listServices(): Promise<{ services: ServiceDto[]; maxConcurrent: number }> {
		const config = this.readConfig()
		const containers = await this.listAllContainers()

		const services = Object.entries(config.services).map(([name, entry]) =>
			this.toServiceDto(name, entry, config.settings, containers),
		)

		return {
			services,
			maxConcurrent: config.settings?.max_concurrent ?? 3,
		}
	}

	async getService(name: string): Promise<ServiceDto> {
		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) {
			throw new NotFoundException(`Service not found: ${name}`)
		}

		const containers = await this.listAllContainers()
		return this.toServiceDto(name, entry, config.settings, containers)
	}

	// ── PROFILE SWITCHING (legacy custom services) ──────────

	async switchProfile(name: string, profile: string): Promise<ServiceDto> {
		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) throw new NotFoundException(`Service not found: ${name}`)
		if (!entry.profiles) throw new BadRequestException(`Service "${name}" does not support profiles`)
		if (!entry.profiles[profile]) {
			throw new BadRequestException(
				`Invalid profile "${profile}". Available: ${Object.keys(entry.profiles).join(', ')}`,
			)
		}

		if (entry.active_profile === profile) {
			const containers = await this.listAllContainers()
			return this.toServiceDto(name, entry, config.settings, containers)
		}

		const targetProfile = entry.profiles[profile]
		await this.recreateProfileContainer(entry, targetProfile.image)

		entry.active_profile = profile
		this.writeConfig(config)

		const containers = await this.listAllContainers()
		return this.toServiceDto(name, entry, config.settings, containers)
	}

	async resetService(name: string): Promise<ServiceDto> {
		return this.switchProfile(name, 'easy')
	}

	async resetAll(): Promise<ServiceDto[]> {
		const config = this.readConfig()
		const results: ServiceDto[] = []

		for (const [name, entry] of Object.entries(config.services)) {
			if (entry.profiles && entry.active_profile !== 'easy') {
				try {
					results.push(await this.switchProfile(name, 'easy'))
				} catch (error) {
					console.error(`Failed to reset ${name}:`, error)
					const containers = await this.listAllContainers()
					results.push(this.toServiceDto(name, entry, config.settings, containers))
				}
			} else {
				const containers = await this.listAllContainers()
				results.push(this.toServiceDto(name, entry, config.settings, containers))
			}
		}

		return results
	}

	// ── DEPLOY / UNDEPLOY (Vulhub + Docker Hub services) ────

	async deployService(name: string): Promise<ServiceDto> {
		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) throw new NotFoundException(`Service not found: ${name}`)
		if (!entry.deploy_mode) {
			throw new BadRequestException(`Service "${name}" uses profile mode, not deploy mode`)
		}

		const runningCount = await this.countRunningDeployServices(config)
		const maxConcurrent = config.settings?.max_concurrent ?? 3
		if (runningCount >= maxConcurrent) {
			throw new BadRequestException(
				`Maximum ${maxConcurrent} services can run concurrently. Stop a service first.`,
			)
		}

		if (entry.deploy_mode === 'compose') {
			await this.deployCompose(name, entry, config.settings)
		} else {
			await this.deployImage(name, entry)
		}

		const containers = await this.listAllContainers()
		return this.toServiceDto(name, entry, config.settings, containers)
	}

	async undeployService(name: string): Promise<ServiceDto> {
		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) throw new NotFoundException(`Service not found: ${name}`)
		if (!entry.deploy_mode) {
			throw new BadRequestException(`Service "${name}" uses profile mode, not deploy mode`)
		}

		if (entry.deploy_mode === 'compose') {
			await this.undeployCompose(name, entry, config.settings)
		} else {
			await this.undeployImage(name)
		}

		const containers = await this.listAllContainers()
		return this.toServiceDto(name, entry, config.settings, containers)
	}

	async undeployAll(): Promise<{ stopped: number }> {
		const config = this.readConfig()
		let stopped = 0

		for (const [name, entry] of Object.entries(config.services)) {
			if (!entry.deploy_mode) continue
			try {
				if (entry.deploy_mode === 'compose') {
					await this.undeployCompose(name, entry, config.settings)
				} else {
					await this.undeployImage(name)
				}
				stopped++
			} catch {
				// already stopped or doesn't exist
			}
		}

		return { stopped }
	}

	async switchVariant(name: string, body: SwitchVariantDto): Promise<SwitchVariantResultDto> {
		if (this.switchLocks.has(name)) {
			throw new ConflictException(`Service "${name}" is already switching`)
		}

		this.switchLocks.add(name)

		try {
			const context = this.buildSwitchVariantContext(name, body)
			const { config, entry, variants, target, fromVariant, targetVariant } = context

			if (fromVariant === targetVariant) {
				return this.buildSwitchVariantResult(
					name,
					context,
					'success',
					false,
					'Variant already active',
				)
			}

			this.assertNoPortConflict(name, entry, config)

			const rollbackVariant = this.resolveRollbackVariant(entry, variants)
			let rolledBack = false
			let switchError: string | null = null

			try {
				await this.recreateImageVariantContainer(name, entry, target.image)
				await this.runVariantHealthCheck(name, entry, target)

				this.applyVariantStateOnSuccess(entry, targetVariant)
				this.writeConfig(config)
				return this.buildSwitchVariantResult(
					name,
					context,
					'success',
					false,
					'Variant switched successfully',
				)
			} catch (error) {
				switchError = error instanceof Error ? error.message : 'unknown switch failure'

				if (body.rollbackOnFailure !== false && rollbackVariant && variants[rollbackVariant]) {
					try {
						const fallback = variants[rollbackVariant]
						await this.recreateImageVariantContainer(name, entry, fallback.image)
						await this.runVariantHealthCheck(name, entry, fallback)
						rolledBack = true
					} catch {
						rolledBack = false
					}
				}

				const message = rolledBack
					? `Switch failed: ${switchError}. Rolled back to ${rollbackVariant}.`
					: `Switch failed: ${switchError}. Rollback failed.`
				return this.buildSwitchVariantResult(
					name,
					context,
					'failed',
					rolledBack,
					message,
				)
			}
		} finally {
			this.switchLocks.delete(name)
		}
	}

	private buildSwitchVariantContext(name: string, body: SwitchVariantDto): SwitchVariantContext {
		const targetVariant = body.targetVariant?.trim()
		if (!targetVariant) {
			throw new BadRequestException('targetVariant is required')
		}

		const config = this.readConfig()
		const entry = config.services[name]
		if (!entry) throw new NotFoundException(`Service not found: ${name}`)
		if (!entry.switchable) {
			throw new BadRequestException(`Service "${name}" is not switchable`)
		}
		if (entry.variant_mode !== 'image') {
			throw new BadRequestException(`Service "${name}" does not support image variant switching`)
		}
		if (this.isProtectedService(name, entry, config.settings)) {
			throw new BadRequestException(`Service "${name}" is protected and cannot be switched`)
		}

		const variants = this.resolveVariants(entry)
		const target = variants[targetVariant]
		if (!target) {
			throw new BadRequestException(
				`Invalid targetVariant "${targetVariant}". Available: ${Object.keys(variants).join(', ')}`,
			)
		}

		const fromVariant = this.resolveActiveVariant(entry)
		if (!fromVariant || !variants[fromVariant]) {
			throw new BadRequestException(`Current active variant is not valid for service "${name}"`)
		}

		return {
			config,
			entry,
			variants,
			target,
			fromVariant,
			targetVariant,
		}
	}

	private applyVariantStateOnSuccess(entry: YamlServiceEntry, targetVariant: string): void {
		entry.active_variant = targetVariant
		entry.last_good_variant = targetVariant
		if (entry.profiles?.[targetVariant]) {
			entry.active_profile = targetVariant
		}
	}

	private async buildSwitchVariantResult(
		name: string,
		context: SwitchVariantContext,
		status: 'success' | 'failed',
		rolledBack: boolean,
		message: string,
	): Promise<SwitchVariantResultDto> {
		const containers = await this.listAllContainers()
		return {
			service: this.toServiceDto(name, context.entry, context.config.settings, containers),
			operation: {
				status,
				from: context.fromVariant,
				to: context.targetVariant,
				rolledBack,
				message,
			},
		}
	}

	// ── COMPOSE DEPLOYMENT ──────────────────────────────────

	private getVulhubDir(settings?: YamlSettings): string {
		return process.env.VULHUB_DIR ?? settings?.vulhub_dir ?? '/vulhub-master'
	}

	private async deployCompose(
		name: string,
		entry: YamlServiceEntry,
		settings?: YamlSettings,
	): Promise<void> {
		const vulhubDir = this.getVulhubDir(settings)
		const composePath = path.join(vulhubDir, entry.compose_path!, 'docker-compose.yml')

		if (!fs.existsSync(composePath)) {
			throw new BadRequestException(`Compose file not found: ${composePath}`)
		}

		const effectivePath = this.generateEffectiveCompose(name, entry, composePath)
		const project = `kz-${name}`

		const cmd = `docker compose -f "${effectivePath}" -p "${project}" up -d --build`

		try {
			await execAsync(cmd)
		} catch (error) {
			throw new BadRequestException(
				`Failed to deploy ${name}: ${error instanceof Error ? error.message : 'unknown error'}`,
			)
		}
	}

	private async undeployCompose(
		name: string,
		entry: YamlServiceEntry,
		settings?: YamlSettings,
	): Promise<void> {
		const vulhubDir = this.getVulhubDir(settings)
		const composePath = path.join(vulhubDir, entry.compose_path!, 'docker-compose.yml')
		const effectivePath = this.getEffectivePath(name)
		const project = `kz-${name}`

		const fileToUse = fs.existsSync(effectivePath) ? effectivePath : composePath
		const cmd = `docker compose -f "${fileToUse}" -p "${project}" down`

		try {
			await execAsync(cmd)
		} catch {
			// best effort
		}

		if (fs.existsSync(effectivePath)) {
			try { fs.unlinkSync(effectivePath) } catch { /* ignore */ }
		}
	}

	private generateEffectiveCompose(
		name: string,
		entry: YamlServiceEntry,
		originalPath: string,
	): string {
		const overrideDir = path.join('/tmp', 'kz-overrides')
		if (!fs.existsSync(overrideDir)) {
			fs.mkdirSync(overrideDir, { recursive: true })
		}

		const effectivePath = path.join(overrideDir, `${name}.yml`)

		const raw = fs.readFileSync(originalPath, 'utf8')
		const compose = yaml.load(raw) as Record<string, unknown>

		if (
			entry.host_port &&
			entry.compose_service &&
			entry.container_port &&
			compose.services &&
			typeof compose.services === 'object'
		) {
			const services = compose.services as Record<string, Record<string, unknown>>
			const svc = services[entry.compose_service]
			if (svc) {
				svc.ports = [`${entry.host_port}:${entry.container_port}`]
			}
		}

		delete compose.version

		const content = yaml.dump(compose, { lineWidth: 120, noRefs: true })
		fs.writeFileSync(effectivePath, content, 'utf8')
		return effectivePath
	}

	private getEffectivePath(name: string): string {
		return path.join('/tmp', 'kz-overrides', `${name}.yml`)
	}

	// ── IMAGE DEPLOYMENT ────────────────────────────────────

	private async deployImage(name: string, entry: YamlServiceEntry): Promise<void> {
		const containerName = `kz-${name}`
		const imageName = entry.image!

		try {
			const existing = docker.getContainer(containerName)
			const info = await existing.inspect()
			if (info.State.Running) return // already running
			await existing.start()
			return
		} catch {
			// container doesn't exist -- create it
		}

		try {
			await new Promise<void>((resolve, reject) => {
				docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
					if (err) { reject(err); return }
					docker.modem.followProgress(stream, (followErr: Error | null) => {
						followErr ? reject(followErr) : resolve()
					})
				})
			})
		} catch (error) {
			console.warn(`Image pull failed for ${imageName}:`, error instanceof Error ? error.message : error)
		}

		const portBindings: Record<string, Array<{ HostPort: string }>> = {}
		const exposedPorts: Record<string, object> = {}

		if (entry.host_port && entry.container_port) {
			const key = `${entry.container_port}/tcp`
			exposedPorts[key] = {}
			portBindings[key] = [{ HostPort: String(entry.host_port) }]
		}

		const container = await docker.createContainer({
			Image: imageName,
			name: containerName,
			ExposedPorts: exposedPorts,
			HostConfig: {
				PortBindings: portBindings,
				RestartPolicy: { Name: 'unless-stopped' },
			},
		})

		await container.start()
	}

	private async undeployImage(name: string): Promise<void> {
		const containerName = `kz-${name}`

		try {
			const existing = docker.getContainer(containerName)
			const info = await existing.inspect()
			if (info.State.Running) {
				await existing.stop()
			}
			await existing.remove({ force: true })
		} catch {
			// doesn't exist
		}
	}

	private getVariantContainerName(name: string, entry: YamlServiceEntry): string {
		if (entry.deploy_mode === 'image') {
			return `kz-${name}`
		}
		return entry.container_name ?? `kz-${name}`
	}

	private async recreateImageVariantContainer(
		name: string,
		entry: YamlServiceEntry,
		image: string,
	): Promise<void> {
		// Phase 1 MVP scope: this recreates a single image-based container in-place.
		// Compose stacks and multi-container dependency orchestration are intentionally out of scope.
		const containerName = this.getVariantContainerName(name, entry)

		try {
			const existing = docker.getContainer(containerName)
			const info = await existing.inspect()
			if (info.State.Running) await existing.stop()
			await existing.remove({ force: true })
		} catch {
			// container doesn't exist
		}

		try {
			await new Promise<void>((resolve, reject) => {
				docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
					if (err) { reject(err); return }
					docker.modem.followProgress(stream, (followErr: Error | null) => {
						followErr ? reject(followErr) : resolve()
					})
				})
			})
		} catch (error) {
			console.warn(`Pull failed for ${image}:`, error instanceof Error ? error.message : error)
		}

		const portBindings: Record<string, Array<{ HostPort: string }>> = {}
		const exposedPorts: Record<string, object> = {}

		for (const mapping of this.resolvePortMappings(entry)) {
			const [hostPart, containerPort] = mapping.split(':')
			if (!hostPart || !containerPort) continue
			const key = `${containerPort}/tcp`
			exposedPorts[key] = {}
			portBindings[key] = [{ HostPort: hostPart }]
		}

		const envList = Object.entries(entry.env ?? {}).map(([k, v]) => `${k}=${v}`)

		const hostConfig: Docker.ContainerCreateOptions['HostConfig'] = {
			PortBindings: portBindings,
			RestartPolicy: { Name: 'unless-stopped' },
		}

		if (entry.network) {
			hostConfig.NetworkMode = entry.network
		}

		const container = await docker.createContainer({
			Image: image,
			name: containerName,
			Env: envList,
			ExposedPorts: exposedPorts,
			HostConfig: hostConfig,
		})

		await container.start()
	}

	// ── PROFILE CONTAINER (legacy) ──────────────────────────

	private async recreateProfileContainer(
		entry: YamlServiceEntry,
		newImage: string,
	): Promise<void> {
		const containerName = entry.container_name!

		try {
			const existing = docker.getContainer(containerName)
			const info = await existing.inspect()
			if (info.State.Running) await existing.stop()
			await existing.remove({ force: true })
		} catch { /* doesn't exist */ }

		try {
			await new Promise<void>((resolve, reject) => {
				docker.pull(newImage, (err: Error | null, stream: NodeJS.ReadableStream) => {
					if (err) { reject(err); return }
					docker.modem.followProgress(stream, (followErr: Error | null) => {
						followErr ? reject(followErr) : resolve()
					})
				})
			})
		} catch (error) {
			console.warn(`Pull failed for ${newImage}:`, error instanceof Error ? error.message : error)
		}

		const portBindings: Record<string, Array<{ HostPort: string }>> = {}
		const exposedPorts: Record<string, object> = {}

		for (const mapping of entry.ports ?? []) {
			const [hostPart, containerPort] = mapping.split(':')
			const key = `${containerPort}/tcp`
			exposedPorts[key] = {}
			portBindings[key] = [{ HostPort: hostPart }]
		}

		const envList = Object.entries(entry.env ?? {}).map(([k, v]) => `${k}=${v}`)

		const container = await docker.createContainer({
			Image: newImage,
			name: containerName,
			Env: envList,
			ExposedPorts: exposedPorts,
			HostConfig: {
				PortBindings: portBindings,
				NetworkMode: entry.network ?? 'bridge',
				RestartPolicy: { Name: 'unless-stopped' },
			},
		})

		await container.start()
	}

	// ── STATUS HELPERS ──────────────────────────────────────

	private async listAllContainers(): Promise<
		Map<string, { id: string; running: boolean }>
	> {
		const result = new Map<string, { id: string; running: boolean }>()

		try {
			const containers = await docker.listContainers({ all: true })
			for (const c of containers) {
				const name = c.Names?.[0]?.replace(/^\//, '') ?? ''
				if (name) {
					result.set(name, { id: c.Id, running: c.State === 'running' })
				}
			}
		} catch (error) {
			console.error('Docker unavailable:', error)
		}

		return result
	}

	private async countRunningDeployServices(config: YamlConfig): Promise<number> {
		const containers = await this.listAllContainers()
		let count = 0

		for (const [name, entry] of Object.entries(config.services)) {
			if (!entry.deploy_mode) continue
			if (entry.deploy_mode === 'image') {
				const containerName = `kz-${name}`
				if (containers.get(containerName)?.running) count++
			} else {
				const projectPrefix = `kz-${name}`
				for (const [cName, info] of containers) {
					if (cName.startsWith(projectPrefix) && info.running) {
						count++
						break
					}
				}
			}
		}

		return count
	}

	private resolveVariants(entry: YamlServiceEntry): Record<string, YamlVariant> {
		if (entry.variants && Object.keys(entry.variants).length > 0) {
			return entry.variants
		}

		if (entry.profiles && Object.keys(entry.profiles).length > 0) {
			const variants: Record<string, YamlVariant> = {}
			for (const [key, profile] of Object.entries(entry.profiles)) {
				variants[key] = {
					image: profile.image,
					label: profile.label,
					cves: profile.cves ?? [],
				}
			}
			return variants
		}

		return {}
	}

	private resolveActiveVariant(entry: YamlServiceEntry): string {
		return entry.active_variant ?? entry.active_profile ?? ''
	}

	private resolveRollbackVariant(
		entry: YamlServiceEntry,
		variants: Record<string, YamlVariant>,
	): string {
		if (entry.last_good_variant && variants[entry.last_good_variant]) {
			return entry.last_good_variant
		}
		const active = this.resolveActiveVariant(entry)
		if (active && variants[active]) {
			return active
		}
		return ''
	}

	private resolvePortMappings(entry: YamlServiceEntry): string[] {
		if (entry.ports?.length) {
			return entry.ports
		}

		if (entry.host_port && entry.container_port) {
			return [`${entry.host_port}:${entry.container_port}`]
		}

		return []
	}

	private resolveHostPort(entry: YamlServiceEntry): number | null {
		if (entry.host_port) return entry.host_port

		const first = this.resolvePortMappings(entry)[0]
		if (!first) return null
		const [host] = first.split(':')
		const parsed = Number(host)
		return Number.isFinite(parsed) ? parsed : null
	}

	private async runVariantHealthCheck(
		name: string,
		entry: YamlServiceEntry,
		variant: YamlVariant,
	): Promise<void> {
		const containerName = this.getVariantContainerName(name, entry)
		const timeoutSec = variant.healthcheck?.timeout_sec ?? 30
		const deadline = Date.now() + timeoutSec * 1000

		while (Date.now() <= deadline) {
			const container = docker.getContainer(containerName)
			let running = false

			try {
				const info = await container.inspect()
				running = info.State.Running
			} catch {
				running = false
			}

			if (running) {
				const hc = variant.healthcheck
				if (!hc) return

				if (hc.type === 'http') {
					const hostPort = this.resolveHostPort(entry)
					if (!hostPort) return

					const pathSuffix = hc.path ?? '/'
					try {
						const response = await fetch(`http://127.0.0.1:${hostPort}${pathSuffix}`)
						if (response.ok) return
					} catch {
						// retry until timeout
					}
				} else if (hc.type === 'tcp') {
					const hostPort = this.resolveHostPort(entry)
					if (!hostPort) return
					const open = await this.checkTcpPort(hostPort)
					if (open) return
				}
			}

			await new Promise(resolve => setTimeout(resolve, 1500))
		}

		throw new BadRequestException('Variant health check timed out')
	}

	private async checkTcpPort(port: number): Promise<boolean> {
		const { Socket } = await import('net')
		return new Promise(resolve => {
			const socket = new Socket()
			let settled = false

			const finish = (ok: boolean) => {
				if (settled) return
				settled = true
				socket.destroy()
				resolve(ok)
			}

			socket.setTimeout(1000)
			socket.once('connect', () => finish(true))
			socket.once('timeout', () => finish(false))
			socket.once('error', () => finish(false))
			socket.connect(port, '127.0.0.1')
		})
	}

	private isProtectedService(
		name: string,
		entry: YamlServiceEntry,
		settings?: YamlSettings,
	): boolean {
		const defaultProtectedServices = ['dashboard-api', 'dashboard-web']
		const configProtected = settings?.protected_service_names ?? []
		const protectedServiceNames = new Set(
			[...defaultProtectedServices, ...configProtected].map(item => item.toLowerCase()),
		)

		const defaultProtectedContainers = ['dashboard-api', 'dashboard-web', 'docker', 'containerd']
		const envProtected =
			process.env.PROTECTED_CONTAINERS?.split(',')
				.map(value => value.trim().toLowerCase())
				.filter(value => value.length > 0) ?? []
		const protectedContainerNames = new Set([
			...defaultProtectedContainers,
			...envProtected,
		])

		const serviceName = name.toLowerCase()
		const containerName = this.getVariantContainerName(name, entry).toLowerCase()

		return protectedServiceNames.has(serviceName) || protectedContainerNames.has(containerName)
	}

	private assertNoPortConflict(name: string, entry: YamlServiceEntry, config: YamlConfig): void {
		const ownPorts = new Set(this.resolvePortMappings(entry).map(mapping => mapping.split(':')[0]).filter(Boolean))
		if (ownPorts.size === 0) return

		for (const [otherName, otherEntry] of Object.entries(config.services)) {
			if (otherName === name) continue
			for (const mapping of this.resolvePortMappings(otherEntry)) {
				const [otherHost] = mapping.split(':')
				if (otherHost && ownPorts.has(otherHost)) {
					throw new BadRequestException(
						`Host port ${otherHost} conflicts with service "${otherName}"`,
					)
				}
			}
		}
	}

	private isDeployServiceRunning(
		name: string,
		entry: YamlServiceEntry,
		containers: Map<string, { id: string; running: boolean }>,
	): { running: boolean; containerId: string | null } {
		if (entry.deploy_mode === 'image') {
			const containerName = `kz-${name}`
			const info = containers.get(containerName)
			return { running: info?.running ?? false, containerId: info?.id ?? null }
		}

		// compose mode: check for any container with the project prefix
		const projectPrefix = `kz-${name}`
		for (const [cName, info] of containers) {
			if (cName.startsWith(projectPrefix) && info.running) {
				return { running: true, containerId: info.id }
			}
		}

		return { running: false, containerId: null }
	}

	// ── DTO CONVERSION ──────────────────────────────────────

	private toServiceDto(
		name: string,
		entry: YamlServiceEntry,
		_settings: YamlSettings | undefined,
		containers: Map<string, { id: string; running: boolean }>,
	): ServiceDto {
		const hasProfiles = !!entry.profiles
		const deployMode = entry.deploy_mode
			? entry.deploy_mode
			: hasProfiles
				? ('profile' as const)
				: ('image' as const)

		let running = false
		let containerId: string | null = null

		if (deployMode === 'profile') {
			const info = containers.get(entry.container_name ?? '')
			running = info?.running ?? false
			containerId = info?.id ?? null
		} else {
			const status = this.isDeployServiceRunning(name, entry, containers)
			running = status.running
			containerId = status.containerId
		}

		const profiles = this.mapProfiles(entry)
		const variants = this.mapVariants(entry)

		const hostPort = this.resolveHostPort(entry)
		const accessUrl = running && hostPort ? `http://localhost:${hostPort}` : null

		const cves = this.resolveActiveCves(entry)

		return {
			name,
			displayName: entry.display_name,
			description: entry.description,
			category: entry.category ?? 'other',
			containerName: entry.container_name ?? `kz-${name}`,
			network: entry.network ?? '',
			ports: entry.ports ?? [],
			activeProfile: entry.active_profile ?? '',
			profiles,
			activeVariant: this.resolveActiveVariant(entry),
			lastGoodVariant: entry.last_good_variant ?? this.resolveActiveVariant(entry),
			switchable: entry.switchable ?? false,
			variantMode: entry.variant_mode ?? null,
			variants,
			deployMode,
			hostPort,
			containerPort: entry.container_port ?? null,
			composePath: entry.compose_path ?? null,
			cves,
			accessUrl,
			running,
			containerId,
		}
	}

	private mapProfiles(entry: YamlServiceEntry): Record<string, ServiceProfileDto> {
		const profiles: Record<string, ServiceProfileDto> = {}
		if (!entry.profiles) return profiles

		for (const [key, profile] of Object.entries(entry.profiles)) {
			profiles[key] = {
				image: profile.image,
				label: profile.label,
				cves: profile.cves ?? [],
			}
		}

		return profiles
	}

	private mapVariants(entry: YamlServiceEntry): Record<string, ServiceVariantDto> {
		const variants: Record<string, ServiceVariantDto> = {}

		for (const [key, variant] of Object.entries(this.resolveVariants(entry))) {
			variants[key] = {
				image: variant.image,
				label: variant.label,
				cves: variant.cves ?? [],
				healthcheck: variant.healthcheck
					? {
						type: variant.healthcheck.type,
						path: variant.healthcheck.path,
						timeoutSec: variant.healthcheck.timeout_sec,
					}
					: undefined,
			}
		}

		return variants
	}

	private resolveActiveCves(entry: YamlServiceEntry): string[] {
		if (entry.profiles && entry.active_profile) {
			const activeProfileData = entry.profiles[entry.active_profile]
			if (activeProfileData?.cves?.length) {
				return activeProfileData.cves
			}
		}

		return entry.cves ?? []
	}

	// ── CONFIG I/O ──────────────────────────────────────────

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
		const raw = yaml.dump(config, { lineWidth: 120, noRefs: true, quotingType: '"' })
		fs.writeFileSync(this.configPath, raw, 'utf8')
	}
}
