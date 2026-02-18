'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

export interface ContainerItem {
	id: string
	name: string
	image: string
	state: string
	status: string
}

interface Props {
	initialContainers: ContainerItem[]
}

export function ContainerDashboard({ initialContainers }: Props) {
	const [containers, setContainers] = useState(initialContainers)
	const [pendingKey, setPendingKey] = useState<string | null>(null)

	const sortedContainers = useMemo(
		() =>
			[...containers].sort((first, second) =>
				first.name.localeCompare(second.name),
			),
		[containers],
	)

	const refreshContainers = async () => {
		const response = await fetch('/api/containers', { cache: 'no-store' })
		if (!response.ok) {
			throw new Error('Failed to refresh containers')
		}
		const data = (await response.json()) as ContainerItem[]
		setContainers(data)
	}

	const runAction = async (
		id: string,
		action: 'start' | 'stop' | 'restart',
	) => {
		const key = `${id}-${action}`
		setPendingKey(key)
		try {
			const response = await fetch(`/api/containers/${id}/${action}`, {
				method: 'POST',
			})
			if (!response.ok) {
				throw new Error(`Failed to ${action} container`)
			}
			await refreshContainers()
		} finally {
			setPendingKey(null)
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Containers</CardTitle>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Image</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className='text-right'>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortedContainers.map(container => (
							<TableRow key={container.id}>
								<TableCell className='font-medium'>{container.name}</TableCell>
								<TableCell className='max-w-[320px] truncate'>
									{container.image}
								</TableCell>
								<TableCell>
									<Badge
										variant={
											container.state === 'running' ? 'default' : 'secondary'
										}
									>
										{container.status}
									</Badge>
								</TableCell>
								<TableCell className='space-x-2 text-right'>
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
								</TableCell>
							</TableRow>
						))}
						{sortedContainers.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={4}
									className='py-6 text-center text-muted-foreground'
								>
									No containers found.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}
