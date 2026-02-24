'use client'

import { useEffect, useState } from 'react'
import {
	AlertTriangle,
	Check,
	Loader2,
	RefreshCw,
	RotateCcw,
	Shield,
	ShieldAlert,
	ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { SharedLayout } from '@/components/shared-layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
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
	containerName: string
	network: string
	ports: string[]
	activeProfile: string
	profiles: Record<string, ServiceProfile>
	running: boolean
	containerId: string | null
}

type ProfileKey = 'easy' | 'medium' | 'hard'

const PROFILE_ORDER: ProfileKey[] = ['easy', 'medium', 'hard']

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
	const [isLoading, setIsLoading] = useState(true)
	const [switchingService, setSwitchingService] = useState<string | null>(null)
	const [isResettingAll, setIsResettingAll] = useState(false)

	const fetchServices = async (showLoader = false) => {
		if (showLoader) setIsLoading(true)
		try {
			const response = await fetch('/api/services', { cache: 'no-store' })
			if (!response.ok) throw new Error('Failed to load services')
			const data = (await response.json()) as ServiceItem[]
			setServices(data)
		} catch {
			toast.error('Failed to load services')
		} finally {
			setIsLoading(false)
		}
	}

	const switchProfile = async (serviceName: string, profile: string) => {
		setSwitchingService(serviceName)
		try {
			const response = await fetch(`/api/services/${serviceName}/profile`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ profile }),
			})

			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Unknown error' }))
				throw new Error(err.message ?? 'Failed to switch profile')
			}

			const updated = (await response.json()) as ServiceItem
			setServices(prev =>
				prev.map(s => (s.name === updated.name ? updated : s)),
			)
			toast.success(`${updated.displayName}: switched to ${profile}`)
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: `Failed to switch ${serviceName} to ${profile}`,
			)
		} finally {
			setSwitchingService(null)
		}
	}

	const resetAll = async () => {
		const confirmed = window.confirm(
			'Reset all services to Easy (most vulnerable) profile?',
		)
		if (!confirmed) return

		setIsResettingAll(true)
		try {
			const response = await fetch('/api/services/reset-all', {
				method: 'POST',
			})
			if (!response.ok) throw new Error('Failed to reset services')
			const data = (await response.json()) as ServiceItem[]
			setServices(data)
			toast.success('All services reset to Easy profile')
		} catch {
			toast.error('Failed to reset all services')
		} finally {
			setIsResettingAll(false)
		}
	}

	useEffect(() => {
		void fetchServices(true)
	}, [])

	const allEasy = services.every(s => s.activeProfile === 'easy')
	const allHard = services.every(s => s.activeProfile === 'hard')

	const statsSidebar = (
		<>
			<p className='mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
				Profile Summary
			</p>
			<div className='space-y-2 text-sm'>
				{PROFILE_ORDER.map(p => {
					const count = services.filter(s => s.activeProfile === p).length
					const style = profileStyles[p]
					return (
						<div key={p} className='flex items-center justify-between px-3 py-1'>
							<span className={cn('capitalize', style.color)}>{p}</span>
							<Badge variant='secondary' className={style.bg}>
								{count}
							</Badge>
						</div>
					)
				})}
			</div>
		</>
	)

	return (
		<SharedLayout sidebar={statsSidebar}>
			<div className='space-y-6'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h2 className='text-lg font-semibold tracking-tight'>
							Service Customization
						</h2>
						<p className='text-sm text-muted-foreground'>
							Switch vulnerability profiles per service. Each profile uses a
							different Docker image tag.
						</p>
					</div>

					<div className='flex items-center gap-2'>
						<Button
							size='sm'
							variant='destructive'
							onClick={() => void resetAll()}
							disabled={isLoading || isResettingAll || allEasy}
						>
							{isResettingAll && (
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
							)}
							<RotateCcw className='mr-2 h-4 w-4' />
							Reset All to Easy
						</Button>
						<IconButton
							variant='outline'
							size='sm'
							aria-label='Refresh services'
							onClick={() => void fetchServices()}
							disabled={isLoading}
							icon={
								<RefreshCw
									className={cn('h-4 w-4', isLoading && 'animate-spin')}
								/>
							}
						/>
					</div>
				</div>

				{allHard && (
					<Card className='border-emerald-500/40 bg-emerald-500/5'>
						<CardContent className='flex items-center gap-3 pt-6'>
							<ShieldCheck className='h-5 w-5 text-emerald-600' />
							<p className='text-sm text-emerald-700 dark:text-emerald-300'>
								All services are set to Hard (fully patched) profile.
							</p>
						</CardContent>
					</Card>
				)}

				{isLoading ? (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						{Array.from({ length: 6 }).map((_, i) => (
							<Card
								key={`skel-${i}`}
								className='border-zinc-200/60 shadow-sm dark:border-zinc-800'
							>
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
						{services.map(service => {
							const isSwitching = switchingService === service.name
							const activeStyle =
								profileStyles[service.activeProfile as ProfileKey] ??
								profileStyles.easy
							const ActiveIcon = activeStyle.icon
							const activeProfile = service.profiles[service.activeProfile]

							return (
								<Card
									key={service.name}
									className={cn(
										'overflow-hidden border-zinc-200/60 shadow-sm transition dark:border-zinc-800',
										isSwitching && 'opacity-70',
									)}
								>
									<CardHeader>
										<div className='flex items-center justify-between gap-3'>
											<CardTitle className='text-base'>
												{service.displayName}
											</CardTitle>
											<div className='flex items-center gap-2'>
												<Badge
													variant='secondary'
													className={cn(
														service.running
															? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
															: 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300',
													)}
												>
													{service.running ? 'Running' : 'Stopped'}
												</Badge>
											</div>
										</div>
										<p className='text-sm text-muted-foreground'>
											{service.description}
										</p>
									</CardHeader>
									<CardContent className='space-y-4'>
										<div className='flex items-center gap-2'>
											<ActiveIcon className={cn('h-4 w-4', activeStyle.color)} />
											<Badge variant='secondary' className={activeStyle.bg}>
												{service.activeProfile.toUpperCase()}
											</Badge>
											{activeProfile && (
												<span className='truncate text-xs text-muted-foreground'>
													{activeProfile.label}
												</span>
											)}
										</div>

										{activeProfile && activeProfile.cves.length > 0 && (
											<div className='flex flex-wrap gap-1'>
												{activeProfile.cves.map(cve => (
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

										<p className='truncate font-mono text-xs text-muted-foreground'>
											{activeProfile?.image ?? 'unknown'}
										</p>

										<div className='flex flex-wrap gap-2'>
											{PROFILE_ORDER.map(profileKey => {
												const isActive = service.activeProfile === profileKey
												const style = profileStyles[profileKey]
												const Icon = style.icon

												return (
													<Button
														key={profileKey}
														size='sm'
														variant={isActive ? 'default' : 'outline'}
														className={cn(
															'min-w-20',
															isActive && 'pointer-events-none',
														)}
														disabled={isSwitching || isResettingAll}
														onClick={() =>
															void switchProfile(service.name, profileKey)
														}
													>
														{isSwitching ? (
															<Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
														) : isActive ? (
															<Check className='mr-1 h-3.5 w-3.5' />
														) : (
															<Icon className='mr-1 h-3.5 w-3.5' />
														)}
														{profileKey.charAt(0).toUpperCase() +
															profileKey.slice(1)}
													</Button>
												)
											})}
										</div>

										<div className='text-xs text-muted-foreground'>
											Container: <code>{service.containerName}</code>
											{service.ports.length > 0 && (
												<span className='ml-2'>
													Ports: {service.ports.join(', ')}
												</span>
											)}
										</div>
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
