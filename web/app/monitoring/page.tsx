'use client'

import { useEffect, useMemo, useState } from 'react'
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	RefreshCw,
	Search,
	Shield,
	XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { SharedLayout } from '@/components/shared-layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface SigmaRule {
	id: string
	title: string
	status: string
	description: string
	level: string
	tactic: string
	tags: string[]
	references: string[]
	cve: string | null
	filePath: string
	rawYaml: string
}

interface ELKStatus {
	elasticsearch: { reachable: boolean; version: string | null; clusterName: string | null }
	kibana: { reachable: boolean; version: string | null; url: string }
}

const levelStyles: Record<string, string> = {
	critical: 'border-red-600/40 bg-red-600/15 text-red-700 dark:text-red-300',
	high: 'border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300',
	medium: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
	low: 'border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300',
}

const tacticLabels: Record<string, string> = {
	'initial access': 'Initial Access',
	execution: 'Execution',
	persistence: 'Persistence',
	'lateral movement': 'Lateral Movement',
	'credential access': 'Credential Access',
	collection: 'Collection',
	discovery: 'Discovery',
	unknown: 'Other',
}

export default function MonitoringPage() {
	const [rules, setRules] = useState<SigmaRule[]>([])
	const [elkStatus, setElkStatus] = useState<ELKStatus | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [expandedRule, setExpandedRule] = useState<string | null>(null)
	const [expandedTactics, setExpandedTactics] = useState<Set<string>>(new Set())

	const fetchAll = async (showLoader = false) => {
		if (showLoader) setIsLoading(true)
		try {
			const [rulesRes, statusRes] = await Promise.all([
				fetch('/api/detection/rules', { cache: 'no-store' }),
				fetch('/api/detection/status', { cache: 'no-store' }),
			])
			if (rulesRes.ok) setRules(await rulesRes.json())
			if (statusRes.ok) setElkStatus(await statusRes.json())
		} catch {
			toast.error('Failed to load monitoring data')
		} finally {
			setIsLoading(false)
		}
	}

	useEffect(() => {
		void fetchAll(true)
	}, [])

	const normalizedQuery = searchQuery.trim().toLowerCase()
	const filteredRules = useMemo(
		() =>
			rules.filter(
				r =>
					normalizedQuery.length === 0 ||
					r.title.toLowerCase().includes(normalizedQuery) ||
					r.description.toLowerCase().includes(normalizedQuery) ||
					r.tactic.toLowerCase().includes(normalizedQuery) ||
					(r.cve?.toLowerCase().includes(normalizedQuery) ?? false) ||
					r.tags.some(t => t.toLowerCase().includes(normalizedQuery)),
			),
		[rules, normalizedQuery],
	)

	const groupedByTactic = useMemo(() => {
		const groups: Record<string, SigmaRule[]> = {}
		for (const rule of filteredRules) {
			const key = rule.tactic || 'unknown'
			if (!groups[key]) groups[key] = []
			groups[key].push(rule)
		}
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
	}, [filteredRules])

	const toggleTactic = (tactic: string) => {
		setExpandedTactics(prev => {
			const next = new Set(prev)
			next.has(tactic) ? next.delete(tactic) : next.add(tactic)
			return next
		})
	}

	const statsSidebar = (
		<>
			<p className='mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
				Detection Stats
			</p>
			<div className='space-y-2 text-sm'>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>Total Rules</span>
					<Badge variant='secondary'>{rules.length}</Badge>
				</div>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>Tactics</span>
					<Badge variant='secondary'>
						{new Set(rules.map(r => r.tactic)).size}
					</Badge>
				</div>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>Critical</span>
					<Badge variant='secondary' className={levelStyles.critical}>
						{rules.filter(r => r.level === 'critical').length}
					</Badge>
				</div>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>High</span>
					<Badge variant='secondary' className={levelStyles.high}>
						{rules.filter(r => r.level === 'high').length}
					</Badge>
				</div>
			</div>
		</>
	)

	return (
		<SharedLayout sidebar={statsSidebar}>
			<div className='space-y-6'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h2 className='text-lg font-semibold tracking-tight'>
							Monitoring & Detection
						</h2>
						<p className='text-sm text-muted-foreground'>
							ELK Stack status, Sigma detection rules, and Kibana dashboards.
						</p>
					</div>
					<IconButton
						variant='outline'
						size='sm'
						aria-label='Refresh'
						onClick={() => void fetchAll()}
						disabled={isLoading}
						icon={<RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />}
					/>
				</div>

				{/* ELK Status */}
				<div className='grid gap-4 md:grid-cols-2'>
					<Card className='border-zinc-200/60 dark:border-zinc-800'>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-sm'>
								<Activity className='h-4 w-4' />
								Elasticsearch
							</CardTitle>
						</CardHeader>
						<CardContent>
							{isLoading ? (
								<Skeleton className='h-8 w-full' />
							) : elkStatus ? (
								<div className='flex items-center gap-3'>
									{elkStatus.elasticsearch.reachable ? (
										<>
											<CheckCircle2 className='h-5 w-5 text-emerald-500' />
											<div>
												<p className='text-sm font-medium text-emerald-700 dark:text-emerald-300'>
													Connected
												</p>
												<p className='text-xs text-muted-foreground'>
													v{elkStatus.elasticsearch.version} &middot;{' '}
													{elkStatus.elasticsearch.clusterName}
												</p>
											</div>
										</>
									) : (
										<>
											<XCircle className='h-5 w-5 text-zinc-400' />
											<div>
												<p className='text-sm font-medium text-zinc-500'>
													Not Running
												</p>
												<p className='text-xs text-muted-foreground'>
													Start with: docker compose -f deploy/elk.compose.yml up -d
												</p>
											</div>
										</>
									)}
								</div>
							) : null}
						</CardContent>
					</Card>

					<Card className='border-zinc-200/60 dark:border-zinc-800'>
						<CardHeader className='pb-3'>
							<CardTitle className='flex items-center gap-2 text-sm'>
								<Activity className='h-4 w-4' />
								Kibana
							</CardTitle>
						</CardHeader>
						<CardContent>
							{isLoading ? (
								<Skeleton className='h-8 w-full' />
							) : elkStatus ? (
								<div className='flex items-center justify-between'>
									<div className='flex items-center gap-3'>
										{elkStatus.kibana.reachable ? (
											<>
												<CheckCircle2 className='h-5 w-5 text-emerald-500' />
												<div>
													<p className='text-sm font-medium text-emerald-700 dark:text-emerald-300'>
														Connected
													</p>
													<p className='text-xs text-muted-foreground'>
														v{elkStatus.kibana.version}
													</p>
												</div>
											</>
										) : (
											<>
												<XCircle className='h-5 w-5 text-zinc-400' />
												<p className='text-sm font-medium text-zinc-500'>
													Not Running
												</p>
											</>
										)}
									</div>
									{elkStatus.kibana.reachable && (
										<a
											href={elkStatus.kibana.url}
											target='_blank'
											rel='noopener noreferrer'
											className='inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400'
										>
											<ExternalLink className='h-3.5 w-3.5' />
											Open Kibana
										</a>
									)}
								</div>
							) : null}
						</CardContent>
					</Card>
				</div>

				{/* Quick Actions */}
				{elkStatus?.kibana.reachable && (
					<div className='flex flex-wrap gap-2'>
						<Button size='sm' variant='outline' asChild>
							<a
								href={`${elkStatus.kibana.url}/app/discover`}
								target='_blank'
								rel='noopener noreferrer'
							>
								<Search className='mr-2 h-3.5 w-3.5' />
								Kibana Discover
							</a>
						</Button>
						<Button size='sm' variant='outline' asChild>
							<a
								href={`${elkStatus.kibana.url}/app/dashboards`}
								target='_blank'
								rel='noopener noreferrer'
							>
								<Activity className='mr-2 h-3.5 w-3.5' />
								Kibana Dashboards
							</a>
						</Button>
					</div>
				)}

				{/* Search */}
				<div className='relative'>
					<Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						placeholder='Search rules by title, CVE, tactic, or tag...'
						value={searchQuery}
						onChange={e => setSearchQuery(e.target.value)}
						className='pl-10'
					/>
				</div>

				{/* Sigma Rules grouped by tactic */}
				{isLoading ? (
					<div className='space-y-4'>
						{Array.from({ length: 3 }).map((_, i) => (
							<Card key={`skel-${i}`} className='border-zinc-200/60 dark:border-zinc-800'>
								<CardHeader><Skeleton className='h-5 w-48' /></CardHeader>
								<CardContent><Skeleton className='h-20 w-full' /></CardContent>
							</Card>
						))}
					</div>
				) : filteredRules.length === 0 ? (
					<Card className='border-zinc-200/60 dark:border-zinc-800'>
						<CardContent className='pt-6'>
							<p className='text-sm text-muted-foreground'>No rules match the search.</p>
						</CardContent>
					</Card>
				) : (
					<div className='space-y-3'>
						{groupedByTactic.map(([tactic, tacticRules]) => {
							const isExpanded = expandedTactics.has(tactic)
							const label = tacticLabels[tactic] ?? tactic

							return (
								<Card key={tactic} className='border-zinc-200/60 dark:border-zinc-800'>
									<button
										type='button'
										className='flex w-full items-center justify-between px-6 py-4 text-left'
										onClick={() => toggleTactic(tactic)}
									>
										<div className='flex items-center gap-3'>
											<Shield className='h-4 w-4 text-muted-foreground' />
											<span className='text-sm font-semibold'>{label}</span>
											<Badge variant='secondary'>{tacticRules.length}</Badge>
										</div>
										{isExpanded ? (
											<ChevronDown className='h-4 w-4 text-muted-foreground' />
										) : (
											<ChevronRight className='h-4 w-4 text-muted-foreground' />
										)}
									</button>

									{isExpanded && (
										<CardContent className='space-y-2 border-t pt-4'>
											{tacticRules.map(rule => {
												const isOpen = expandedRule === rule.id
												const sevStyle = levelStyles[rule.level] ?? levelStyles.medium

												return (
													<div
														key={rule.id}
														className='rounded-md border border-zinc-200/60 dark:border-zinc-800'
													>
														<button
															type='button'
															className='flex w-full items-center justify-between px-4 py-3 text-left'
															onClick={() => setExpandedRule(isOpen ? null : rule.id)}
														>
															<div className='flex items-center gap-2'>
																<Badge variant='secondary' className={cn('text-[11px]', sevStyle)}>
																	{rule.level}
																</Badge>
																<span className='text-sm font-medium'>{rule.title}</span>
																{rule.cve && (
																	<Badge variant='secondary' className='font-mono text-[11px]'>
																		<AlertTriangle className='mr-1 h-3 w-3' />
																		{rule.cve}
																	</Badge>
																)}
															</div>
															{isOpen ? (
																<ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
															) : (
																<ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
															)}
														</button>

														{isOpen && (
															<div className='border-t px-4 py-3'>
																<p className='mb-3 text-sm text-muted-foreground'>
																	{rule.description}
																</p>

																<div className='mb-3 flex flex-wrap gap-1'>
																	{rule.tags.map(tag => (
																		<Badge
																			key={tag}
																			variant='secondary'
																			className='border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-700 dark:text-violet-300'
																		>
																			{tag}
																		</Badge>
																	))}
																</div>

																{rule.references.length > 0 && (
																	<div className='mb-3'>
																		<p className='mb-1 text-xs font-medium text-muted-foreground'>
																			References
																		</p>
																		{rule.references.map(ref => (
																			<a
																				key={ref}
																				href={ref}
																				target='_blank'
																				rel='noopener noreferrer'
																				className='block text-xs text-blue-600 hover:underline dark:text-blue-400'
																			>
																				{ref}
																			</a>
																		))}
																	</div>
																)}

																<details className='group'>
																	<summary className='cursor-pointer text-xs font-medium text-muted-foreground'>
																		Raw YAML
																	</summary>
																	<pre className='mt-2 max-h-64 overflow-auto rounded bg-[#0b0f14] p-3 font-mono text-xs text-zinc-200'>
																		{rule.rawYaml}
																	</pre>
																</details>
															</div>
														)}
													</div>
												)
											})}
										</CardContent>
									)}
								</Card>
							)
						})}
					</div>
				)}
			</div>
		</SharedLayout>
	)
}
