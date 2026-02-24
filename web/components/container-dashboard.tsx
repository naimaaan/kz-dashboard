'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Boxes,
	Clock3,
	Cpu,
	ChevronDown,
	Copy,
	Loader2,
	MemoryStick,
	Play,
	RefreshCw,
	RotateCcw,
	ScrollText,
	Server,
	Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet'
import { SharedLayout } from '@/components/shared-layout'
import { cn } from '@/lib/utils'

export interface ContainerItem {
	id: string
	name: string
	image: string
	state: string
	status: string
	labels: Record<string, string>
	cluster: string | null
}

interface HostStats {
	cpuPercent: number
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

interface LogsResponse {
	text: string
}

type StatusFilter = 'all' | 'running' | 'stopped' | 'restarting'
type BulkAction = 'start' | 'stop' | 'restart'
type ClusterAction = 'start' | 'stop' | 'restart'

interface ClusterActionResult {
	ok: true
	total: number
	succeeded: string[]
	failed: Array<{ id: string; name: string; error: string }>
}

interface BulkActionResult {
	ok: true
	total: number
	succeeded: string[]
	failed: Array<{ id: string; name: string; error: string }>
}

interface SummaryCard {
	label: string
	value: number
	filter: StatusFilter
	icon: typeof Boxes
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
	const [selectedCluster, setSelectedCluster] = useState<string>('all')
	const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
	const [isLogsOpen, setIsLogsOpen] = useState(false)
	const [logsContainer, setLogsContainer] = useState<ContainerItem | null>(null)
	const [logsText, setLogsText] = useState('')
	const [logsTail, setLogsTail] = useState(200)
	const [isLogsLoading, setIsLogsLoading] = useState(false)
	const [logsError, setLogsError] = useState<string | null>(null)
	const logsScrollRef = useRef<HTMLDivElement | null>(null)
	const [clusterActionSummary, setClusterActionSummary] = useState<{
		cluster: string
		action: ClusterAction
		total: number
		succeeded: number
		failed: Array<{ id: string; name: string; error: string }>
	} | null>(null)

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

	const isBusy = pendingKey !== null || pendingBulkAction !== null

	const summaryCards = useMemo<SummaryCard[]>(
		() => [
			{
				label: 'Total containers',
				value: summary.total,
				filter: 'all',
				icon: Boxes,
			},
			{
				label: 'Running',
				value: summary.running,
				filter: 'running',
				icon: Play,
			},
			{
				label: 'Stopped',
				value: summary.stopped,
				filter: 'stopped',
				icon: Square,
			},
			{
				label: 'Restarting',
				value: summary.restarting,
				filter: 'restarting',
				icon: RotateCcw,
			},
		],
		[summary],
	)

	const statusBadgeClassName = (container: ContainerItem) => {
		const state = lifecycleState(container)

		if (state === 'running') {
			return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
		}

		if (state === 'restarting') {
			return 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
		}

		return 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300'
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
				const clusterMatch =
					selectedCluster === 'all' ||
					(container.cluster ?? 'other').toLowerCase() ===
						selectedCluster.toLowerCase()

				if (!clusterMatch) {
					return false
				}

				const queryMatch =
					normalizedQuery.length === 0 ||
					container.name.toLowerCase().includes(normalizedQuery) ||
					container.image.toLowerCase().includes(normalizedQuery)

				const statusMatch = matchesStatusFilter(container, statusFilter)

				return queryMatch && statusMatch
			})
			.sort((first, second) => first.name.localeCompare(second.name))
	}, [containers, searchQuery, statusFilter, selectedCluster])

	const clusterStats = useMemo(() => {
		const counts: Record<string, number> = {}

		for (const container of containers) {
			const cluster = (container.cluster ?? 'other').toLowerCase()
			counts[cluster] = (counts[cluster] ?? 0) + 1
		}

		const clusters = Object.entries(counts)
			.map(([name, count]) => ({ name, count }))
			.sort((first, second) => first.name.localeCompare(second.name))

		return {
			total: containers.length,
			clusters,
		}
	}, [containers])

	const activeClusterLabel =
		selectedCluster === 'all' ? 'All clusters' : `Cluster: ${selectedCluster}`

	const hostCpuPercent = useMemo(() => {
		if (!hostStats) {
			return null
		}

		return Math.min(100, Math.max(0, hostStats.cpuPercent))
	}, [hostStats])

	const hostRamPercent = useMemo(() => {
		if (!hostStats) {
			return null
		}

		return Math.min(100, Math.max(0, hostStats.usedMemPercent))
	}, [hostStats])

	const systemBadgeText = useMemo(() => {
		const cpuText = hostCpuPercent === null ? '--' : Math.round(hostCpuPercent)
		const ramText = hostRamPercent === null ? '--' : Math.round(hostRamPercent)

		return `System Ready · ${summary.running} running · CPU ${cpuText}% · RAM ${ramText}%`
	}, [summary.running, hostCpuPercent, hostRamPercent])

	const isSystemWarning =
		(hostCpuPercent !== null && hostCpuPercent > 80) ||
		(hostRamPercent !== null && hostRamPercent > 90)

	const lastUpdatedText = useMemo(() => {
		if (!lastUpdatedAt) {
			return 'Not synced yet'
		}

		return lastUpdatedAt.toLocaleTimeString()
	}, [lastUpdatedAt])

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
			setLastUpdatedAt(new Date())
			return true
		} catch {
			setErrorMessage('Failed to load containers. Please try again.')
			return false
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

	const fetchVisibleContainerStats = async (
		visibleContainers: ContainerItem[],
	) => {
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

	const parseLogsPayload = async (response: Response) => {
		const contentType = response.headers.get('content-type') ?? ''

		if (contentType.includes('application/json')) {
			const parsed = (await response.json()) as LogsResponse
			return parsed.text ?? ''
		}

		return response.text()
	}

	const formatMemory = (bytes: number) => {
		const gb = bytes / (1024 * 1024 * 1024)
		if (gb >= 1) {
			return `${gb.toFixed(1)} GB`
		}
		return formatMb(bytes)
	}

	const formatUptime = (uptimeSeconds: number) => {
		const totalMinutes = Math.max(Math.floor(uptimeSeconds / 60), 0)
		const days = Math.floor(totalMinutes / (60 * 24))
		const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
		const minutes = totalMinutes % 60

		if (days > 0) {
			return `${days}d ${hours}h`
		}

		if (hours > 0) {
			return `${hours}h ${minutes}m`
		}

		return `${minutes}m`
	}

	const uptimeBadgeClassName = useMemo(() => {
		if (!hostStats) {
			return 'border-border bg-secondary text-secondary-foreground'
		}

		if (hostStats.uptimeSeconds < 15 * 60) {
			return 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300'
		}

		if (hostStats.uptimeSeconds < 60 * 60) {
			return 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
		}

		return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
	}, [hostStats])

	const lifecycleState = (container: ContainerItem) => {
		const state = container.state.toLowerCase()
		const status = container.status.toLowerCase()

		if (state === 'restarting' || status.includes('restarting')) {
			return 'restarting' as const
		}

		if (state === 'running') {
			return 'running' as const
		}

		return 'stopped' as const
	}

	const formatClusterLabel = (cluster: string | null) => cluster ?? 'other'

	const formatContainerUptime = (status: string) => {
		const normalized = status.trim()
		if (normalized.length === 0) {
			return 'n/a'
		}

		const upIndex = normalized.toLowerCase().indexOf('up ')
		if (upIndex === -1) {
			return 'stopped'
		}

		const uptime = normalized
			.slice(upIndex + 3)
			.split('(')[0]
			.trim()
		return uptime.length > 0 ? uptime : 'running'
	}

	const shortId = (id: string) => id.slice(0, 12)

	const copyContainerId = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id)
			toast.success('Container id copied')
		} catch {
			toast.error('Failed to copy container id')
		}
	}

	const refreshAll = async (showLoader = false) => {
		await Promise.all([refreshContainers(showLoader), fetchHostStats()])
		await fetchVisibleContainerStats(filteredContainers)
	}

	const fetchContainerLogs = async (container: ContainerItem, tail: number) => {
		setIsLogsLoading(true)
		setLogsError(null)

		try {
			const response = await fetch(
				`/api/containers/${container.id}/logs?tail=${tail}`,
				{ cache: 'no-store' },
			)

			if (!response.ok) {
				throw new Error('Failed to fetch logs')
			}

			const text = await parseLogsPayload(response)
			setLogsText(text)
		} catch {
			setLogsError('Failed to load logs. Try refresh.')
			setLogsText('')
		} finally {
			setIsLogsLoading(false)
		}
	}

	const openLogs = async (container: ContainerItem) => {
		setLogsContainer(container)
		setLogsText('')
		setLogsError(null)
		setIsLogsOpen(true)
		await fetchContainerLogs(container, logsTail)
	}

	const copyLogs = async () => {
		if (!logsText) {
			return
		}

		try {
			await navigator.clipboard.writeText(logsText)
			toast.success('Logs copied')
		} catch {
			toast.error('Failed to copy logs')
		}
	}

	useEffect(() => {
		void refreshAll(true)
	}, [])

	useEffect(() => {
		void fetchVisibleContainerStats(filteredContainers)
	}, [filteredContainers])

	useEffect(() => {
		if (pendingKey !== null || pendingBulkAction !== null) {
			return
		}

		const intervalId = setInterval(() => {
			void refreshAll()
		}, 5000)

		return () => {
			clearInterval(intervalId)
		}
	}, [pendingKey, pendingBulkAction, filteredContainers])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== 'r' || event.ctrlKey || event.metaKey) {
				return
			}

			const target = event.target as HTMLElement | null
			if (!target) {
				return
			}

			const tag = target.tagName.toLowerCase()
			if (
				tag === 'input' ||
				tag === 'textarea' ||
				tag === 'select' ||
				target.isContentEditable
			) {
				return
			}

			event.preventDefault()
			void refreshAll()
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [filteredContainers])

	useEffect(() => {
		if (!isLogsOpen || !logsScrollRef.current) {
			return
		}

		logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight
	}, [logsText, isLogsOpen])

	const runAction = async (
		id: string,
		action: 'start' | 'stop' | 'restart',
	) => {
		const key = `${id}-${action}`
		const containerName =
			containers.find(container => container.id === id)?.name ?? 'Container'
		setPendingKey(key)
		setErrorMessage(null)
		try {
			const response = await fetch(`/api/containers/${id}/${action}`, {
				method: 'POST',
			})
			if (!response.ok) {
				throw new Error(`Failed to ${action} container`)
			}
			toast.success(`${containerName}: ${action} queued`)
			await refreshContainers()
		} catch {
			setErrorMessage(`Failed to ${action} container. Please try again.`)
			toast.error(`${containerName}: failed to ${action}`)
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
			toast.success(
				`Bulk ${action}: ${result.succeeded.length}/${result.total} succeeded`,
			)
			if (result.failed.length > 0) {
				setErrorMessage(
					`${result.failed.length} container(s) failed during bulk ${action}.`,
				)
				toast.error(
					`Bulk ${action}: ${result.failed.length} container(s) failed`,
				)
			}

			await refreshContainers()
		} catch {
			setErrorMessage(`Failed to ${action} containers. Please try again.`)
			toast.error(`Bulk ${action} failed`)
		} finally {
			setPendingBulkAction(null)
		}
	}

	const runClusterAction = async (action: ClusterAction) => {
		if (selectedCluster === 'all') {
			return
		}

		if (action !== 'start') {
			const isConfirmed = window.confirm(
				action === 'stop'
					? `Stop all containers in cluster "${selectedCluster}"?`
					: `Restart all containers in cluster "${selectedCluster}"?`,
			)
			if (!isConfirmed) {
				return
			}
		}

		setPendingBulkAction(action)
		setErrorMessage(null)
		setClusterActionSummary(null)

		try {
			const response = await fetch(
				`/api/clusters/${encodeURIComponent(selectedCluster)}/${action}`,
				{ method: 'POST' },
			)

			if (!response.ok) {
				throw new Error(`Failed to ${action} cluster`)
			}

			const result = (await response.json()) as ClusterActionResult
			setClusterActionSummary({
				cluster: selectedCluster,
				action,
				total: result.total,
				succeeded: result.succeeded.length,
				failed: result.failed,
			})

			toast.success(
				`${selectedCluster}: ${action} ${result.succeeded.length}/${result.total} succeeded`,
			)

			if (result.failed.length > 0) {
				toast.error(`${result.failed.length} container(s) failed`)
			}

			await refreshAll()
		} catch {
			setErrorMessage(`Failed to ${action} cluster. Please try again.`)
			toast.error(`Cluster ${action} failed`)
		} finally {
			setPendingBulkAction(null)
		}
	}

	const clusterSidebar = (
		<>
			<p className='mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
				Clusters
			</p>
			<button
				type='button'
				onClick={() => setSelectedCluster('all')}
				className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
					selectedCluster === 'all'
						? 'bg-accent text-accent-foreground'
						: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
				}`}
			>
				<span>All</span>
				<Badge variant='secondary'>{clusterStats.total}</Badge>
			</button>
			<div className='mt-1 space-y-1'>
				{clusterStats.clusters.map(cluster => (
					<button
						type='button'
						key={cluster.name}
						onClick={() => setSelectedCluster(cluster.name)}
						className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
							selectedCluster === cluster.name
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
						}`}
					>
						<span className='truncate'>{cluster.name}</span>
						<Badge variant='secondary'>{cluster.count}</Badge>
					</button>
				))}
			</div>
		</>
	)

	return (
		<SharedLayout sidebar={clusterSidebar}>
			<div className='space-y-8'>
				{/* Sub-header with system info and cluster controls */}
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div className='flex flex-wrap items-center gap-2'>
						<Badge
							variant='default'
							className={cn(
								'border-transparent',
								isSystemWarning
									? 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300'
									: 'bg-emerald-600/90 text-white dark:bg-emerald-600',
							)}
						>
							{systemBadgeText}
						</Badge>
						<Badge variant='secondary' className='font-mono text-[11px]'>
							Updated {lastUpdatedText}
						</Badge>
						<span className='text-sm text-muted-foreground'>
							{activeClusterLabel} · Press R to refresh
						</span>
					</div>

					<div className='flex items-center gap-2'>
						{selectedCluster !== 'all' && (
							<>
								<Button
									size='sm'
									className='min-w-24'
									onClick={() => void runClusterAction('start')}
									disabled={isLoading || isBusy}
								>
									Start Cluster
								</Button>
								<Button
									size='sm'
									variant='destructive'
									className='min-w-24'
									onClick={() => void runClusterAction('stop')}
									disabled={isLoading || isBusy}
								>
									Stop Cluster
								</Button>
								<Button
									size='sm'
									variant='secondary'
									className='min-w-24'
									onClick={() => void runClusterAction('restart')}
									disabled={isLoading || isBusy}
								>
									Restart Cluster
								</Button>
							</>
						)}
						<IconButton
							variant='outline'
							size='sm'
							aria-label='Refresh dashboard'
							onClick={() => void refreshAll()}
							disabled={isLoading || isBusy}
							icon={
								<RefreshCw
									className={cn('h-4 w-4', isLoading && 'animate-spin')}
								/>
							}
						/>
					</div>
				</div>

				{clusterActionSummary && (
					<Card className='border-zinc-200/60 shadow-sm dark:border-zinc-800'>
						<CardContent className='pt-6'>
							<div className='flex flex-wrap items-center gap-2 text-sm'>
								<Badge variant='secondary'>
									{clusterActionSummary.cluster}
								</Badge>
								<p className='text-muted-foreground'>
									Cluster {clusterActionSummary.action}:{' '}
									{clusterActionSummary.succeeded}/
									{clusterActionSummary.total} succeeded
								</p>
							</div>

							{clusterActionSummary.failed.length > 0 && (
								<details className='mt-3 rounded-md border p-2'>
									<summary className='flex cursor-pointer list-none items-center justify-between text-xs text-muted-foreground'>
										<span>
											{clusterActionSummary.failed.length} failed containers
										</span>
										<ChevronDown className='h-4 w-4' />
									</summary>
									<div className='mt-2 space-y-1 text-xs text-muted-foreground'>
										{clusterActionSummary.failed.map(item => (
											<p key={item.id}>{item.name}</p>
										))}
									</div>
								</details>
							)}
						</CardContent>
					</Card>
				)}

				<section id='overview' className='space-y-4'>
					<div>
						<h2 className='text-lg font-semibold tracking-tight'>
							Overview
						</h2>
						<p className='text-sm text-muted-foreground'>
							Live service and workload summary.
						</p>
					</div>
					{isLoading ? (
						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
							{Array.from({ length: 4 }).map((_, index) => (
								<Card
									key={`summary-skeleton-${index}`}
									className='h-full border-zinc-200/60 shadow-sm dark:border-zinc-800'
								>
									<CardHeader className='pb-2'>
										<Skeleton className='h-4 w-28' />
									</CardHeader>
									<CardContent>
										<Skeleton className='h-8 w-16' />
									</CardContent>
								</Card>
							))}
						</div>
					) : (
						<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
							{summaryCards.map(card => {
								const Icon = card.icon
								const isActive = statusFilter === card.filter

								return (
									<Card
										key={card.label}
										className={cn(
											'h-full border-zinc-200/60 shadow-sm transition hover:shadow-md dark:border-zinc-800',
											isActive ? 'ring-2 ring-primary' : '',
										)}
									>
										<button
											type='button'
											onClick={() => setStatusFilter(card.filter)}
											className='flex h-full w-full flex-col justify-between gap-3 text-left'
										>
											<CardHeader className='pb-2'>
												<div className='flex items-center justify-between'>
													<CardTitle className='text-sm'>
														{card.label}
													</CardTitle>
													<Icon className='h-4 w-4 text-muted-foreground' />
												</div>
											</CardHeader>
											<CardContent>
												<p className='text-2xl font-semibold'>
													{card.value}
												</p>
											</CardContent>
										</button>
									</Card>
								)
							})}
						</div>
					)}

					<div className='flex flex-wrap items-center gap-3 border-t border-zinc-200/60 pt-4 dark:border-zinc-800'>
						<Button
							size='sm'
							className='min-w-24'
							onClick={() => runBulkAction('start')}
							disabled={isLoading || isBusy}
						>
							{pendingBulkAction === 'start' && (
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
							)}
							{pendingBulkAction === 'start'
								? 'Starting all...'
								: 'Start All'}
						</Button>
						<Button
							size='sm'
							variant='destructive'
							className='min-w-24'
							onClick={() => runBulkAction('stop')}
							disabled={isLoading || isBusy}
						>
							{pendingBulkAction === 'stop' && (
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
							)}
							{pendingBulkAction === 'stop'
								? 'Stopping all...'
								: 'Stop All'}
						</Button>
						<Button
							size='sm'
							variant='secondary'
							className='min-w-24'
							onClick={() => runBulkAction('restart')}
							disabled={isLoading || isBusy}
						>
							{pendingBulkAction === 'restart' && (
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
							)}
							{pendingBulkAction === 'restart'
								? 'Restarting all...'
								: 'Restart All'}
						</Button>
					</div>
				</section>

				<section
					id='containers'
					className='space-y-4 border-t border-zinc-200/60 pt-6 dark:border-zinc-800'
				>
					<div>
						<h2 className='text-lg font-semibold tracking-tight'>
							Containers
						</h2>
						<p className='text-sm text-muted-foreground'>
							Operational controls and runtime metadata.
						</p>
					</div>
					<div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
						<Input
							placeholder='Search by container name or image'
							value={searchQuery}
							onChange={event => setSearchQuery(event.target.value)}
							className='lg:max-w-xl'
						/>
						<Select
							value={statusFilter}
							onChange={event =>
								setStatusFilter(event.target.value as StatusFilter)
							}
							className='lg:w-64'
						>
							<option value='all'>All</option>
							<option value='running'>Running</option>
							<option value='stopped'>Exited/Stopped</option>
							<option value='restarting'>Restarting</option>
						</Select>
						<p className='text-sm text-muted-foreground lg:ml-auto'>
							Matched: {filteredContainers.length}
						</p>
					</div>

					{errorMessage && (
						<Card className='border-destructive/40'>
							<CardContent className='flex items-center justify-between gap-3 pt-6'>
								<p className='text-sm text-destructive'>{errorMessage}</p>
								<Button
									size='sm'
									variant='outline'
									onClick={() => void refreshAll()}
								>
									Try again
								</Button>
							</CardContent>
						</Card>
					)}

					{isLoading ? (
						<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
							{Array.from({ length: 6 }).map((_, index) => (
								<Card
									key={`container-skeleton-${index}`}
									className='border-zinc-200/60 shadow-sm dark:border-zinc-800'
								>
									<CardHeader className='space-y-3'>
										<div className='flex items-center justify-between gap-3'>
											<Skeleton className='h-5 w-40' />
											<Skeleton className='h-5 w-20 rounded-full' />
										</div>
										<Skeleton className='h-4 w-full' />
									</CardHeader>
									<CardContent className='space-y-3'>
										<Skeleton className='h-8 w-full' />
										<Skeleton className='h-8 w-full' />
									</CardContent>
								</Card>
							))}
						</div>
					) : filteredContainers.length === 0 ? (
						<Card className='border-zinc-200/60 shadow-sm dark:border-zinc-800'>
							<CardContent className='pt-6'>
								<p className='text-sm text-muted-foreground'>
									No containers match the current filters.
								</p>
							</CardContent>
						</Card>
					) : (
						<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
							{filteredContainers.map(container => {
								const state = lifecycleState(container)
								const startDisabled = state !== 'stopped' || isBusy
								const stopDisabled = state === 'stopped' || isBusy
								const restartDisabled = state !== 'running' || isBusy
								const stats = containerStatsById[container.id]
								const isStartPending =
									pendingKey === `${container.id}-start`
								const isStopPending = pendingKey === `${container.id}-stop`
								const isRestartPending =
									pendingKey === `${container.id}-restart`

								return (
									<Card
										key={container.id}
										className='overflow-hidden border-zinc-200/60 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:hover:border-zinc-700'
									>
										<CardHeader>
											<div className='flex items-center justify-between gap-3'>
												<CardTitle className='truncate text-base'>
													{container.name}
												</CardTitle>
												<Badge
													variant='secondary'
													className={statusBadgeClassName(container)}
												>
													{container.status}
												</Badge>
											</div>
										</CardHeader>
										<CardContent className='space-y-4'>
											<p className='truncate font-mono text-xs text-muted-foreground'>
												{container.image}
											</p>
											<div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
												<Badge variant='secondary' className='font-medium'>
													<Server className='mr-1 h-3.5 w-3.5' />
													{formatClusterLabel(container.cluster)}
												</Badge>
												<Badge variant='secondary'>
													<Clock3 className='mr-1 h-3.5 w-3.5' />
													{formatContainerUptime(container.status)}
												</Badge>
												<div className='inline-flex items-center gap-1 rounded-full border border-zinc-200/70 bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'>
													<span>{shortId(container.id)}</span>
													<IconButton
														variant='outline'
														size='sm'
														className='h-5 w-5 border-0 bg-transparent hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
														aria-label={`Copy id for ${container.name}`}
														onClick={() =>
															void copyContainerId(container.id)
														}
														icon={<Copy className='h-3 w-3' />}
													/>
												</div>
											</div>

											{stats && (
												<div className='flex flex-wrap gap-2'>
													<Badge
														variant='secondary'
														className='bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
													>
														<Cpu className='mr-1 h-3.5 w-3.5' />
														{stats.cpuPercent.toFixed(1)}%
													</Badge>
													<Badge
														variant='secondary'
														className='bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
													>
														<MemoryStick className='mr-1 h-3.5 w-3.5' />
														{formatMb(stats.memUsageBytes)}
													</Badge>
												</div>
											)}

											<div className='flex flex-wrap gap-2'>
												<Button
													size='sm'
													className='min-w-20'
													onClick={() => runAction(container.id, 'start')}
													disabled={startDisabled}
												>
													{isStartPending && (
														<Loader2 className='mr-2 h-4 w-4 animate-spin' />
													)}
													{isStartPending ? 'Starting...' : 'Start'}
												</Button>
												<Button
													size='sm'
													variant='destructive'
													className='min-w-20'
													onClick={() => runAction(container.id, 'stop')}
													disabled={stopDisabled}
												>
													{isStopPending && (
														<Loader2 className='mr-2 h-4 w-4 animate-spin' />
													)}
													{isStopPending ? 'Stopping...' : 'Stop'}
												</Button>
												<Button
													size='sm'
													variant='secondary'
													className='min-w-20'
													onClick={() => runAction(container.id, 'restart')}
													disabled={restartDisabled}
												>
													{isRestartPending && (
														<Loader2 className='mr-2 h-4 w-4 animate-spin' />
													)}
													{isRestartPending ? 'Restarting...' : 'Restart'}
												</Button>
												<Button
													size='sm'
													variant='outline'
													className='min-w-20'
													onClick={() => void openLogs(container)}
												>
													Logs
												</Button>
											</div>
										</CardContent>
									</Card>
								)
							})}
						</div>
					)}
				</section>

				<section
					id='system'
					className='space-y-4 border-t border-zinc-200/60 pt-6 dark:border-zinc-800'
				>
					<h2 className='text-lg font-semibold tracking-tight'>System</h2>
					<div className='grid gap-4 md:grid-cols-2'>
						<Card className='border-zinc-200/60 shadow-sm dark:border-zinc-800'>
							<CardHeader className='pb-2'>
								<CardTitle className='flex items-center gap-2 text-sm'>
									<MemoryStick className='h-4 w-4 text-muted-foreground' />
									Host RAM used
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								{hostStats ? (
									<>
										<div className='flex items-end justify-between gap-3'>
											<p className='text-2xl font-semibold'>
												{hostStats.usedMemPercent.toFixed(1)}%
											</p>
											<p className='font-mono text-xs text-muted-foreground'>
												{formatMemory(hostStats.usedMemBytes)} /{' '}
												{formatMemory(hostStats.totalMemBytes)}
											</p>
										</div>
										<Progress
											value={hostStats.usedMemPercent}
											className='h-2 rounded-full'
										/>
										<p className='text-xs text-muted-foreground'>
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

						<Card className='border-zinc-200/60 shadow-sm dark:border-zinc-800'>
							<CardHeader className='pb-2'>
								<CardTitle className='flex items-center gap-2 text-sm'>
									<Cpu className='h-4 w-4 text-muted-foreground' />
									Host CPU usage
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								{hostStats ? (
									<>
										<div className='flex items-end justify-between gap-3'>
											<p className='text-2xl font-semibold'>
												{hostCpuPercent?.toFixed(1)}%
											</p>
											<p className='font-mono text-xs text-muted-foreground'>
												System-wide
											</p>
										</div>
										<Progress
											value={hostCpuPercent ?? 0}
											className='h-2 rounded-full'
										/>
										<div className='flex items-center justify-between'>
											<p className='text-xs text-muted-foreground'>
												Host uptime
											</p>
											<Badge
												variant='secondary'
												className={uptimeBadgeClassName}
											>
												{formatUptime(hostStats.uptimeSeconds)}
											</Badge>
										</div>
									</>
								) : (
									<p className='text-sm text-muted-foreground'>
										{hostStatsError ?? 'Loading...'}
									</p>
								)}
							</CardContent>
						</Card>
					</div>
				</section>
			</div>

			<Sheet open={isLogsOpen} onOpenChange={setIsLogsOpen}>
				<SheetContent className='h-full w-full max-w-4xl border-l border-zinc-800 bg-[#0b0f14] p-0 text-zinc-100 [&>button]:opacity-100 [&>button]:text-zinc-200 [&>button]:hover:bg-white/10 [&>button]:hover:text-zinc-100 [&>button]:focus:ring-zinc-500'>
					<div className='flex h-full flex-col'>
						<div className='sticky top-0 z-10 border-b border-zinc-800 bg-[#0b0f14] px-5 py-4'>
							<div className='flex items-center justify-between gap-3'>
								<SheetHeader className='space-y-0'>
									<SheetTitle className='text-zinc-100'>
										Logs {logsContainer ? `· ${logsContainer.name}` : ''}
									</SheetTitle>
									<SheetDescription className='text-zinc-400'>
										{logsContainer ? logsContainer.status : 'Container output'}
									</SheetDescription>
								</SheetHeader>
								<Button
									size='sm'
									variant='outline'
									className='border-zinc-700 bg-zinc-900/40 text-zinc-100 hover:bg-zinc-900 hover:text-zinc-100'
									onClick={() =>
										logsContainer
											? void fetchContainerLogs(logsContainer, logsTail)
											: undefined
									}
									disabled={!logsContainer || isLogsLoading}
								>
									Refresh
								</Button>
							</div>
						</div>

						<div className='px-5 py-3'>
							<div className='flex flex-wrap items-center gap-2'>
								<Select
									value={String(logsTail)}
									onChange={event => setLogsTail(Number(event.target.value))}
									className='w-32 border-zinc-700 bg-zinc-900/40 text-zinc-100'
								>
									<option value='50'>Tail 50</option>
									<option value='200'>Tail 200</option>
									<option value='500'>Tail 500</option>
								</Select>
								<Button
									size='sm'
									variant='outline'
									className='border-zinc-700 bg-zinc-900/40 text-zinc-100 hover:bg-zinc-900 hover:text-zinc-100'
									onClick={() => void copyLogs()}
									disabled={!logsText}
								>
									<Copy className='mr-2 h-4 w-4' />
									Copy
								</Button>
							</div>
						</div>

						<div
							ref={logsScrollRef}
							className='mx-5 mb-5 flex-1 overflow-auto rounded-md border border-zinc-800 bg-[#0b0f14] p-3 font-mono'
						>
							{isLogsLoading ? (
								<p className='text-sm text-zinc-400'>Loading logs...</p>
							) : logsError ? (
								<p className='text-sm text-zinc-300'>{logsError}</p>
							) : (
								<pre className='whitespace-pre-wrap text-xs leading-relaxed text-zinc-200'>
									{logsText || 'No logs yet.'}
								</pre>
							)}
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</SharedLayout>
	)
}
