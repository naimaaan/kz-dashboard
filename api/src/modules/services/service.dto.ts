export interface ServiceProfileDto {
	image: string
	label: string
	cves: string[]
}

export interface ServiceVariantHealthcheckDto {
	type: 'http' | 'tcp'
	path?: string
	timeoutSec?: number
}

export interface ServiceVariantDto {
	type: 'image' | 'compose'
	image?: string
	label: string
	cves: string[]
	composePath?: string
	composeService?: string
	hostPort?: number
	containerPort?: number
	healthcheck?: ServiceVariantHealthcheckDto
}

export interface SwitchVariantOperationDto {
	status: 'success' | 'failed'
	from: string
	to: string
	rolledBack: boolean
	message: string
}

export interface SwitchVariantResultDto {
	service: ServiceDto
	operation: SwitchVariantOperationDto
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
	activeVariant: string
	lastGoodVariant: string
	switchable: boolean
	variantMode: 'image' | 'compose' | null
	variants: Record<string, ServiceVariantDto>

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
