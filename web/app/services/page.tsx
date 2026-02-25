'use client'

import { useEffect, useMemo, useState } from 'react'
import {
	AlertTriangle,
	Check,
	ExternalLink,
	Loader2,
	Play,
	RefreshCw,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { SharedLayout } from '@/components/shared-layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface ServiceProfile {
	image: string
	label: string
	cves: string[]
}

interface ServiceItem {
	name: string
	displayName: string
	description: string
	category: string
	containerName: string
	network: string
	ports: string[]
	activeProfile: string
	profiles: Record<string, ServiceProfile>
	deployMode: 'profile' | 'compose' | 'image'
	hostPort: number | null
	containerPort: number | null
	composePath: string | null
	cves: string[]
	accessUrl: string | null
	running: boolean
	containerId: string | null
}

type CategoryKey = 'all' | 'custom' | 'cms' | 'infrastructure' | 'databases' | 'training'

const CATEGORIES: { key: CategoryKey; label: string }[] = [
	{ key: 'all', label: 'All Services' },
	{ key: 'cms', label: 'CMS & Web' },
	{ key: 'infrastructure', label: 'Infrastructure' },
	{ key: 'databases', label: 'Databases' },
	{ key: 'training', label: 'Training Labs' },
	{ key: 'custom', label: 'Custom (Profile)' },
]

type ProfileKey = 'easy' | 'medium' | 'hard'

const profileStyles: Record<ProfileKey, { icon: typeof Shield; color: string; bg: string }> = {
	easy: {
		icon: ShieldAlert,
		color: 'text-rose-600 dark:text-rose-400',
		bg: 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300',
	},
	medium: {
		icon: Shield,
		color: 'text-amber-600 dark:text-amber-400',
		bg: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
	},
	hard: {
		icon: ShieldCheck,
		color: 'text-emerald-600 dark:text-emerald-400',
		bg: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
	},
}

export default function ServicesPage() {
	const [services, setServices] = useState<ServiceItem[]>([])
	const [maxConcurrent, setMaxConcurrent] = useState(3)
	const [isLoading, setIsLoading] = useState(true)
	const [activeCategory, setActiveCategory] = useState<CategoryKey>('all')
	const [busyService, setBusyService] = useState<string | null>(null)
	const [isResettingAll, setIsResettingAll] = useState(false)

	const fetchServices = async (showLoader = false) => {
		if (showLoader) setIsLoading(true)
		try {
			const response = await fetch('/api/services', { cache: 'no-store' })
			if (!response.ok) throw new Error('Failed to load services')
			const data = await response.json()
			setServices(data.services ?? data)
			if (data.maxConcurrent != null) setMaxConcurrent(data.maxConcurrent)
		} catch {
			toast.error('Failed to load services')
		} finally {
			setIsLoading(false)
		}
	}

	// Deploy-mode actions
	const deployService = async (name: string) => {
		setBusyService(name)
		try {
			const response = await fetch(`/api/services/${name}/deploy`, { method: 'POST' })
			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Deploy failed' }))
				throw new Error(err.message ?? 'Deploy failed')
			}
			const updated = (await response.json()) as ServiceItem
			setServices(prev => prev.map(s => (s.name === updated.name ? updated : s)))
			toast.success(`${updated.displayName}: deployed`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Deploy failed')
		} finally {
			setBusyService(null)
		}
	}

	const undeployService = async (name: string) => {
		setBusyService(name)
		try {
			const response = await fetch(`/api/services/${name}/undeploy`, { method: 'POST' })
			if (!response.ok) throw new Error('Undeploy failed')
			const updated = (await response.json()) as ServiceItem
			setServices(prev => prev.map(s => (s.name === updated.name ? updated : s)))
			toast.success(`${updated.displayName}: stopped`)
		} catch {
			toast.error('Undeploy failed')
		} finally {
			setBusyService(null)
		}
	}

	const undeployAll = async () => {
		if (!window.confirm('Stop all running Vulhub / Docker Hub services?')) return
		setIsResettingAll(true)
		try {
			await fetch('/api/services/undeploy-all', { method: 'POST' })
			await fetchServices()
			toast.success('All deploy-mode services stopped')
		} catch {
			toast.error('Failed to stop all')
		} finally {
			setIsResettingAll(false)
		}
	}

	// Profile-mode actions (legacy)
	const switchProfile = async (serviceName: string, profile: string) => {
		setBusyService(serviceName)
		try {
			const response = await fetch(`/api/services/${serviceName}/profile`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ profile }),
			})
			if (!response.ok) throw new Error('Switch failed')
			const updated = (await response.json()) as ServiceItem
			setServices(prev => prev.map(s => (s.name === updated.name ? updated : s)))
			toast.success(`${updated.displayName}: switched to ${profile}`)
		} catch {
			toast.error(`Failed to switch profile`)
		} finally {
			setBusyService(null)
		}
	}

	useEffect(() => {
		void fetchServices(true)
	}, [])

	const filteredServices = useMemo(
		() =>
			activeCategory === 'all'
				? services
				: services.filter(s => s.category === activeCategory),
		[services, activeCategory],
	)

	const deployServices = services.filter(s => s.deployMode !== 'profile')
	const runningDeployCount = deployServices.filter(s => s.running).length
	const capacityPercent = Math.min(100, (runningDeployCount / maxConcurrent) * 100)
	const atCapacity = runningDeployCount >= maxConcurrent

	const categorySidebar = (
		<>
			<p className='mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
				Categories
			</p>
			<div className='space-y-1'>
				{CATEGORIES.map(cat => {
					const count =
						cat.key === 'all'
							? services.length
							: services.filter(s => s.category === cat.key).length
					if (count === 0 && cat.key !== 'all') return null
					return (
						<button
							key={cat.key}
							type='button'
							onClick={() => setActiveCategory(cat.key)}
							className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
								activeCategory === cat.key
									? 'bg-accent text-accent-foreground font-medium'
									: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
							}`}
						>
							<span>{cat.label}</span>
							<Badge variant='secondary'>{count}</Badge>
						</button>
					)
				})}
			</div>

			<div className='mt-6 border-t pt-4'>
				<p className='mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
					Resource Usage
				</p>
				<div className='space-y-2 px-3'>
					<div className='flex items-center justify-between text-sm'>
						<span className='text-muted-foreground'>Running</span>
						<span className='font-medium'>
							{runningDeployCount}/{maxConcurrent}
						</span>
					</div>
					<Progress
						value={capacityPercent}
						className={cn(
							'h-2',
							atCapacity ? '[&>div]:bg-rose-500' : '[&>div]:bg-emerald-500',
						)}
					/>
					{atCapacity && (
						<p className='text-xs text-rose-600 dark:text-rose-400'>
							At capacity. Stop a service to start another.
						</p>
					)}
				</div>
			</div>
		</>
	)

	return (
		<SharedLayout sidebar={categorySidebar}>
			<div className='space-y-6'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h2 className='text-lg font-semibold tracking-tight'>
							Lab Services
						</h2>
						<p className='text-sm text-muted-foreground'>
							Deploy vulnerable services from Vulhub and Docker Hub.
							Max {maxConcurrent} running at once for stability.
						</p>
					</div>

					<div className='flex items-center gap-2'>
						{runningDeployCount > 0 && (
							<Button
								size='sm'
								variant='destructive'
								onClick={() => void undeployAll()}
								disabled={isResettingAll}
							>
								{isResettingAll && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
								<Square className='mr-2 h-4 w-4' />
								Stop All Lab Services
							</Button>
						)}
						<IconButton
							variant='outline'
							size='sm'
							aria-label='Refresh services'
							onClick={() => void fetchServices()}
							disabled={isLoading}
							icon={<RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />}
						/>
					</div>
				</div>

				{atCapacity && (
					<Card className='border-amber-500/40 bg-amber-500/5'>
						<CardContent className='flex items-center gap-3 pt-6'>
							<AlertTriangle className='h-5 w-5 text-amber-600' />
							<p className='text-sm text-amber-700 dark:text-amber-300'>
								Maximum {maxConcurrent} services running. Stop a service before
								starting another to keep the system stable.
							</p>
						</CardContent>
					</Card>
				)}

				{isLoading ? (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						{Array.from({ length: 6 }).map((_, i) => (
							<Card key={`skel-${i}`} className='border-zinc-200/60 shadow-sm dark:border-zinc-800'>
								<CardHeader>
									<Skeleton className='h-5 w-40' />
									<Skeleton className='mt-2 h-4 w-full' />
								</CardHeader>
								<CardContent className='space-y-3'>
									<Skeleton className='h-8 w-full' />
									<Skeleton className='h-8 w-full' />
								</CardContent>
							</Card>
						))}
					</div>
				) : (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						{filteredServices.map(service => {
							const isBusy = busyService === service.name
							const isDeployMode = service.deployMode !== 'profile'

							return (
								<Card
									key={service.name}
									className={cn(
										'overflow-hidden border-zinc-200/60 shadow-sm transition dark:border-zinc-800',
										isBusy && 'opacity-70',
									)}
								>
									<CardHeader>
										<div className='flex items-center justify-between gap-3'>
											<CardTitle className='text-base'>
												{service.displayName}
											</CardTitle>
											<Badge
												variant='secondary'
												className={cn(
													service.running
														? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
														: 'border-zinc-300/40 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400',
												)}
											>
												{service.running ? 'Running' : 'Stopped'}
											</Badge>
										</div>
										<p className='text-sm text-muted-foreground'>
											{service.description}
										</p>
									</CardHeader>
									<CardContent className='space-y-3'>
										{/* CVE badges */}
										{service.cves.length > 0 && (
											<div className='flex flex-wrap gap-1'>
												{service.cves.map(cve => (
													<Badge
														key={cve}
														variant='secondary'
														className='border-orange-500/30 bg-orange-500/10 font-mono text-[11px] text-orange-700 dark:text-orange-300'
													>
														<AlertTriangle className='mr-1 h-3 w-3' />
														{cve}
													</Badge>
												))}
											</div>
										)}

										{/* Category + port info */}
										<div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
											<Badge variant='secondary' className='capitalize'>
												{service.category}
											</Badge>
											{service.deployMode === 'compose' && (
												<Badge variant='secondary' className='text-[11px]'>
													Vulhub
												</Badge>
											)}
											{service.hostPort && (
												<span className='font-mono'>
													:{service.hostPort}
												</span>
											)}
										</div>

										{/* Access link when running */}
										{service.running && service.accessUrl && (
											<a
												href={service.accessUrl}
												target='_blank'
												rel='noopener noreferrer'
												className='inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400'
											>
												<ExternalLink className='h-3.5 w-3.5' />
												{service.accessUrl}
											</a>
										)}

										{/* Deploy-mode actions */}
										{isDeployMode && (
											<div className='flex gap-2'>
												{service.running ? (
													<Button
														size='sm'
														variant='destructive'
														className='min-w-24'
														disabled={isBusy || isResettingAll}
														onClick={() => void undeployService(service.name)}
													>
														{isBusy ? (
															<Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
														) : (
															<Square className='mr-1 h-3.5 w-3.5' />
														)}
														Stop
													</Button>
												) : (
													<Button
														size='sm'
														className='min-w-24'
														disabled={isBusy || isResettingAll || atCapacity}
														onClick={() => void deployService(service.name)}
													>
														{isBusy ? (
															<Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
														) : (
															<Play className='mr-1 h-3.5 w-3.5' />
														)}
														Deploy
													</Button>
												)}
											</div>
										)}

										{/* Profile-mode actions (legacy) */}
										{!isDeployMode && service.profiles && (
											<div className='space-y-2'>
												<div className='flex items-center gap-2'>
													{(() => {
														const key = service.activeProfile as ProfileKey
														const style = profileStyles[key] ?? profileStyles.easy
														const Icon = style.icon
														return (
															<>
																<Icon className={cn('h-4 w-4', style.color)} />
																<Badge variant='secondary' className={style.bg}>
																	{service.activeProfile.toUpperCase()}
																</Badge>
															</>
														)
													})()}
												</div>
												<div className='flex flex-wrap gap-2'>
													{(['easy', 'medium', 'hard'] as ProfileKey[]).map(profileKey => {
														if (!service.profiles[profileKey]) return null
														const isActive = service.activeProfile === profileKey
														const style = profileStyles[profileKey]
														const Icon = style.icon
														return (
															<Button
																key={profileKey}
																size='sm'
																variant={isActive ? 'default' : 'outline'}
																className={cn('min-w-20', isActive && 'pointer-events-none')}
																disabled={isBusy || isResettingAll}
																onClick={() => void switchProfile(service.name, profileKey)}
															>
																{isBusy ? (
																	<Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
																) : isActive ? (
																	<Check className='mr-1 h-3.5 w-3.5' />
																) : (
																	<Icon className='mr-1 h-3.5 w-3.5' />
																)}
																{profileKey.charAt(0).toUpperCase() + profileKey.slice(1)}
															</Button>
														)
													})}
												</div>
											</div>
										)}
									</CardContent>
								</Card>
							)
						})}
					</div>
				)}
			</div>
		</SharedLayout>
	)
}
