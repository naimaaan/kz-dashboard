import { Injectable, NotFoundException } from '@nestjs/common'
import * as Docker from 'dockerode'
import { ContainerDto } from './container.dto'

const isWin = process.platform === 'win32'

const docker = isWin
	? new Docker({ socketPath: '//./pipe/docker_engine' })
	: new Docker({ socketPath: '/var/run/docker.sock' })

interface DockerContainerSummary {
	Id: string
	Names?: string[]
	Image: string
	State: string
	Status: string
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

	private toContainerDto(container: DockerContainerSummary): ContainerDto {
		return {
			id: container.Id,
			name: container.Names?.[0]?.replace(/^\//, '') ?? container.Id,
			image: container.Image,
			state: container.State,
			status: container.Status,
		}
	}

	private async assertExists(id: string): Promise<void> {
		try {
			await this.docker.getContainer(id).inspect()
		} catch {
			throw new NotFoundException(`Container not found: ${id}`)
		}
	}
}
