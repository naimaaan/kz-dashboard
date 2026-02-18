export interface BulkActionDto {
	ids?: string[]
	names?: string[]
	includeAll?: boolean
}

export interface BulkActionFailureDto {
	id: string
	name: string
	error: string
}

export interface BulkActionResultDto {
	ok: true
	total: number
	succeeded: string[]
	failed: BulkActionFailureDto[]
}
