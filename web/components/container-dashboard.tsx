'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface ContainerItem {
	id: string
	name: string
	image: string
	state: string
	status: string
}
export function ContainerDashboard() {
	const [containers, setContainers] = useState<ContainerItem[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [pendingKey, setPendingKey] = useState<string | null>(null)

	const sortedContainers = useMemo(
		() =>
			[...containers].sort((first, second) =>
				first.name.localeCompare(second.name),
			),
		[containers],
	)

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

	useEffect(() => {
		void refreshContainers(true)
	}, [])

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
				<div className='flex items-center gap-3'>
					<Badge variant='default'>System Ready</Badge>
					<Button
						variant='outline'
						onClick={() => refreshContainers()}
						disabled={isLoading || pendingKey !== null}
					>
						{isLoading ? 'Refreshing...' : 'Refresh'}
					</Button>
				</div>
			</div>

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
			) : sortedContainers.length === 0 ? (
				<Card>
					<CardContent className='pt-6'>
						<p className='text-sm text-muted-foreground'>
							No containers found.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
					{sortedContainers.map(container => (
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
