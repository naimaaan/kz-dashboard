export interface ContainerDto {
	id: string
	name: string
	image: string
	state: string
	status: string
	labels: Record<string, string>
	cluster: string | null
}
