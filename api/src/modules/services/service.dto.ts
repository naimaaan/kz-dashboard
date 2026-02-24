export interface ServiceProfileDto {
	image: string
	label: string
	cves: string[]
}

export interface ServiceDto {
	name: string
	displayName: string
	description: string
	category: string

	/** Legacy profile-based fields (custom services) */
	containerName: string
	network: string
	ports: string[]
	activeProfile: string
	profiles: Record<string, ServiceProfileDto>

	/** New deploy-mode fields (Vulhub / Docker Hub services) */
	deployMode: 'profile' | 'compose' | 'image'
	hostPort: number | null
	containerPort: number | null
	composePath: string | null
	cves: string[]
	accessUrl: string | null

	running: boolean
	containerId: string | null
}
