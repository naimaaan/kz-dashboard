export interface ServiceProfileDto {
	image: string
	label: string
	cves: string[]
}

export interface ServiceDto {
	name: string
	displayName: string
	description: string
	containerName: string
	network: string
	ports: string[]
	activeProfile: string
	profiles: Record<string, ServiceProfileDto>
	running: boolean
	containerId: string | null
}
