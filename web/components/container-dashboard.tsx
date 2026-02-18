'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

export interface ContainerItem {
	id: string
	name: string
	image: string
	state: string
	status: string
}

interface HostStats {
	cpuLoad: number | null
	cpuLoadNote?: string
	totalMemBytes: number
	freeMemBytes: number
	usedMemBytes: number
	usedMemPercent: number
	uptimeSeconds: number
}

interface ContainerStatsSnapshot {
	cpuPercent: number
	memUsageBytes: number
	memLimitBytes: number
	memPercent: number
	pids: number | null
}

type StatusFilter = 'all' | 'running' | 'stopped' | 'restarting'
type BulkAction = 'start' | 'stop' | 'restart'

interface BulkActionResult {
	ok: true
	total: number
	succeeded: string[]
	failed: Array<{ id: string; name: string; error: string }>
}

export function ContainerDashboard() {
	const [containers, setContainers] = useState<ContainerItem[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [hostStats, setHostStats] = useState<HostStats | null>(null)
	const [hostStatsError, setHostStatsError] = useState<string | null>(null)
	const [containerStatsById, setContainerStatsById] = useState<
		Record<string, ContainerStatsSnapshot>
	>({})
	const [pendingKey, setPendingKey] = useState<string | null>(null)
	const [pendingBulkAction, setPendingBulkAction] = useState<BulkAction | null>(
		null,
	)
	const [searchQuery, setSearchQuery] = useState('')
	const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

	const summary = useMemo(() => {
		let running = 0
		let restarting = 0
		let stopped = 0

		for (const container of containers) {
			const state = container.state.toLowerCase()
			const status = container.status.toLowerCase()

			if (state === 'restarting' || status.includes('restarting')) {
				restarting += 1
				continue
			}

			if (state === 'running') {
				running += 1
				continue
			}

			stopped += 1
		}

		return {
			total: containers.length,
			running,
			stopped,
			restarting,
		}
	}, [containers])

	const statusBadgeVariant = (container: ContainerItem) => {
		const state = container.state.toLowerCase()
		const status = container.status.toLowerCase()
		if (state === 'running' && !status.includes('restarting')) {
			return 'default' as const
		}
		return 'secondary' as const
	}

	const matchesStatusFilter = (
		container: ContainerItem,
		filter: StatusFilter,
	) => {
		const state = container.state.toLowerCase()
		const status = container.status.toLowerCase()

		if (filter === 'all') {
			return true
		}

		if (filter === 'running') {
			return state === 'running' && !status.includes('restarting')
		}

		if (filter === 'restarting') {
			return state === 'restarting' || status.includes('restarting')
		}

		return state === 'exited' || state === 'stopped' || state === 'created'
	}

	const filteredContainers = useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase()

		return containers
			.filter(container => {
				const queryMatch =
					normalizedQuery.length === 0 ||
					container.name.toLowerCase().includes(normalizedQuery) ||
					container.image.toLowerCase().includes(normalizedQuery)

				const statusMatch = matchesStatusFilter(container, statusFilter)

				return queryMatch && statusMatch
			})
			.sort((first, second) => first.name.localeCompare(second.name))
	}, [containers, searchQuery, statusFilter])

	const refreshContainers = async (showLoader = false) => {
		if (showLoader) {
			setIsLoading(true)
		}
		setErrorMessage(null)
		try {
			const response = await fetch('/api/containers', { cache: 'no-store' })
			if (!response.ok) {
				throw new Error('Unable to load containers')
			}
			const data = (await response.json()) as ContainerItem[]
			setContainers(data)
		} catch {
			setErrorMessage('Failed to load containers. Please try again.')
		} finally {
			setIsLoading(false)
		}
	}

	const fetchHostStats = async () => {
		try {
			const response = await fetch('/api/stats/host', { cache: 'no-store' })
			if (!response.ok) {
				throw new Error('Failed to load host stats')
			}

			const data = (await response.json()) as HostStats
			setHostStats(data)
			setHostStatsError(null)
		} catch {
			setHostStatsError('Host stats unavailable')
		}
	}

	const runWithConcurrency = async <T,>(
		items: T[],
		limit: number,
		handler: (item: T) => Promise<void>,
	) => {
		let cursor = 0

		const workers = Array.from(
			{ length: Math.min(limit, items.length) },
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

	const fetchVisibleContainerStats = async (visibleContainers: ContainerItem[]) => {
		if (visibleContainers.length === 0) {
			return
		}

		const updates: Record<string, ContainerStatsSnapshot> = {}

		await runWithConcurrency(visibleContainers, 6, async container => {
			try {
				const response = await fetch(`/api/containers/${container.id}/stats`, {
					cache: 'no-store',
				})
				if (!response.ok) {
					return
				}

				const stats = (await response.json()) as ContainerStatsSnapshot
				updates[container.id] = stats
			} catch {
				return
			}
		})

		if (Object.keys(updates).length > 0) {
			setContainerStatsById(previous => ({ ...previous, ...updates }))
		}
	}

	const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`

	useEffect(() => {
		void refreshContainers(true)
		void fetchHostStats()
	}, [])

	useEffect(() => {
		void fetchVisibleContainerStats(filteredContainers)
	}, [filteredContainers])

	useEffect(() => {
		if (pendingKey !== null || pendingBulkAction !== null) {
			return
		}

		const intervalId = setInterval(() => {
			void refreshContainers()
			void fetchHostStats()
			void fetchVisibleContainerStats(filteredContainers)
		}, 5000)

		return () => {
			clearInterval(intervalId)
		}
	}, [pendingKey, pendingBulkAction, filteredContainers])

	const runAction = async (
		id: string,
		action: 'start' | 'stop' | 'restart',
	) => {
		const key = `${id}-${action}`
		setPendingKey(key)
		setErrorMessage(null)
		try {
			const response = await fetch(`/api/containers/${id}/${action}`, {
				method: 'POST',
			})
			if (!response.ok) {
				throw new Error(`Failed to ${action} container`)
			}
			await refreshContainers()
		} catch {
			setErrorMessage(`Failed to ${action} container. Please try again.`)
		} finally {
			setPendingKey(null)
		}
	}

	const runBulkAction = async (action: BulkAction) => {
		if (action !== 'start') {
			const isConfirmed = window.confirm(
				action === 'stop'
					? 'Stop all containers (except protected)?'
					: 'Restart all containers (except protected)?',
			)
			if (!isConfirmed) {
				return
			}
		}

		setPendingBulkAction(action)
		setErrorMessage(null)
		try {
			const response = await fetch(`/api/containers/bulk/${action}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({ includeAll: true }),
			})

			if (!response.ok) {
				throw new Error(`Failed to ${action} containers`)
			}

			const result = (await response.json()) as BulkActionResult
			if (result.failed.length > 0) {
				setErrorMessage(
					`${result.failed.length} container(s) failed during bulk ${action}.`,
				)
			}

			await refreshContainers()
		} catch {
			setErrorMessage(`Failed to ${action} containers. Please try again.`)
		} finally {
			setPendingBulkAction(null)
		}
	}

	return (
		<div className='space-y-6'>
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='text-3xl font-semibold tracking-tight'>
						KZ-Sploitable Dashboard
					</h1>
					<p className='mt-1 text-sm text-muted-foreground'>
						Container operations overview and controls.
					</p>
				</div>
				<div className='flex flex-wrap items-center gap-3'>
					<Badge variant='default'>System Ready</Badge>
					<Button
						size='sm'
						onClick={() => runBulkAction('start')}
						disabled={
							isLoading || pendingKey !== null || pendingBulkAction !== null
						}
					>
						{pendingBulkAction === 'start' ? 'Starting all...' : 'Start All'}
					</Button>
					<Button
						size='sm'
						variant='outline'
						onClick={() => runBulkAction('stop')}
						disabled={
							isLoading || pendingKey !== null || pendingBulkAction !== null
						}
					>
						{pendingBulkAction === 'stop' ? 'Stopping all...' : 'Stop All'}
					</Button>
					<Button
						size='sm'
						variant='outline'
						onClick={() => runBulkAction('restart')}
						disabled={
							isLoading || pendingKey !== null || pendingBulkAction !== null
						}
					>
						{pendingBulkAction === 'restart'
							? 'Restarting all...'
							: 'Restart All'}
					</Button>
					<Button
						variant='outline'
						onClick={() => refreshContainers()}
						disabled={
							isLoading || pendingKey !== null || pendingBulkAction !== null
						}
					>
						{isLoading ? 'Refreshing...' : 'Refresh'}
					</Button>
				</div>
			</div>

			<section className='space-y-3'>
				<h2 className='text-lg font-semibold tracking-tight'>System</h2>
				<div className='grid gap-4 md:grid-cols-2'>
					<Card>
						<CardHeader className='pb-2'>
							<CardTitle className='text-sm'>Host RAM used</CardTitle>
						</CardHeader>
						<CardContent>
							{hostStats ? (
								<>
									<p className='text-2xl font-semibold'>
										{formatMb(hostStats.usedMemBytes)}
									</p>
									<p className='mt-1 text-sm text-muted-foreground'>
										{hostStats.usedMemPercent.toFixed(1)}%
									</p>
								</>
							) : (
								<p className='text-sm text-muted-foreground'>
									{hostStatsError ?? 'Loading...'}
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className='pb-2'>
							<CardTitle className='text-sm'>Host CPU load</CardTitle>
						</CardHeader>
						<CardContent>
							{hostStats ? (
								hostStats.cpuLoad === null ? (
									<p className='text-sm text-muted-foreground'>
										{hostStats.cpuLoadNote ?? 'N/A on Windows'}
									</p>
								) : (
									<p className='text-2xl font-semibold'>
										{hostStats.cpuLoad.toFixed(2)}
									</p>
								)
							) : (
								<p className='text-sm text-muted-foreground'>
									{hostStatsError ?? 'Loading...'}
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			</section>

			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>Total containers</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-2xl font-semibold'>{summary.total}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>Running</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-2xl font-semibold'>{summary.running}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>Stopped</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-2xl font-semibold'>{summary.stopped}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm'>Restarting</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-2xl font-semibold'>{summary.restarting}</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardContent className='pt-6'>
					<div className='grid gap-3 md:grid-cols-[2fr_1fr]'>
						<Input
							placeholder='Search by container name or image'
							value={searchQuery}
							onChange={event => setSearchQuery(event.target.value)}
						/>
						<Select
							value={statusFilter}
							onChange={event =>
								setStatusFilter(event.target.value as StatusFilter)
							}
						>
							<option value='all'>All</option>
							<option value='running'>Running</option>
							<option value='stopped'>Exited/Stopped</option>
							<option value='restarting'>Restarting</option>
						</Select>
					</div>
					<p className='mt-3 text-sm text-muted-foreground'>
						Matched containers: {filteredContainers.length}
					</p>
				</CardContent>
			</Card>

			{errorMessage && (
				<Card className='border-destructive/40'>
					<CardContent className='flex items-center justify-between gap-3 pt-6'>
						<p className='text-sm text-destructive'>{errorMessage}</p>
						<Button
							size='sm'
							variant='outline'
							onClick={() => refreshContainers()}
						>
							Try again
						</Button>
					</CardContent>
				</Card>
			)}

			{isLoading ? (
				<Card>
					<CardContent className='pt-6'>
						<p className='text-sm text-muted-foreground'>
							Loading containers...
						</p>
					</CardContent>
				</Card>
			) : filteredContainers.length === 0 ? (
				<Card>
					<CardContent className='pt-6'>
						<p className='text-sm text-muted-foreground'>
							No containers match the current filters.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
					{filteredContainers.map(container => (
						<Card key={container.id}>
							<CardHeader>
								<div className='flex items-center justify-between gap-3'>
									<CardTitle className='truncate text-base'>
										{container.name}
									</CardTitle>
									<Badge variant={statusBadgeVariant(container)}>
										{container.status}
									</Badge>
								</div>
							</CardHeader>
							<CardContent className='space-y-4'>
								<p className='truncate text-sm text-muted-foreground'>
									{container.image}
								</p>
								{containerStatsById[container.id] && (
									<div className='flex flex-wrap gap-2'>
										<Badge variant='secondary'>
											CPU {containerStatsById[container.id].cpuPercent.toFixed(1)}%
										</Badge>
										<Badge variant='secondary'>
											RAM{' '}
											{formatMb(containerStatsById[container.id].memUsageBytes)}
										</Badge>
									</div>
								)}
								<div className='flex flex-wrap gap-2'>
									<Button
										size='sm'
										onClick={() => runAction(container.id, 'start')}
										disabled={pendingKey !== null}
									>
										{pendingKey === `${container.id}-start`
											? 'Starting...'
											: 'Start'}
									</Button>
									<Button
										size='sm'
										variant='outline'
										onClick={() => runAction(container.id, 'stop')}
										disabled={pendingKey !== null}
									>
										{pendingKey === `${container.id}-stop`
											? 'Stopping...'
											: 'Stop'}
									</Button>
									<Button
										size='sm'
										variant='outline'
										onClick={() => runAction(container.id, 'restart')}
										disabled={pendingKey !== null}
									>
										{pendingKey === `${container.id}-restart`
											? 'Restarting...'
											: 'Restart'}
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
