'use client'

import { useEffect, useMemo, useState } from 'react'
import {
	AlertTriangle,
	ArrowLeft,
	BookOpen,
	ExternalLink,
	Loader2,
	RefreshCw,
	Search,
	Shield,
	ShieldAlert,
	Swords,
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

interface GuideMeta {
	slug: string
	service: string
	cve: string | null
	tactic: string
	technique: string
	severity: string
	category: string
	port: number
	hasAttackGuide: boolean
	hasDefensePlaybook: boolean
}

interface GuideContent {
	meta: GuideMeta
	content: string
}

type TabKey = 'attack-guides' | 'defense-playbooks'

const severityStyles: Record<string, string> = {
	critical: 'border-red-600/40 bg-red-600/15 text-red-700 dark:text-red-300',
	high: 'border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300',
	medium: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
	low: 'border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300',
}

function SimpleMarkdown({ content }: { content: string }) {
	const html = content
		.replace(/^### (.+)$/gm, '<h3 class="mt-6 mb-2 text-base font-semibold">$1</h3>')
		.replace(/^## (.+)$/gm, '<h2 class="mt-8 mb-3 text-lg font-bold border-b pb-1 border-zinc-200 dark:border-zinc-800">$1</h2>')
		.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mb-4">$1</h1>')
		.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
			`<pre class="my-3 overflow-auto rounded-md bg-[#0b0f14] p-4 font-mono text-xs leading-relaxed text-zinc-200"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`,
		)
		.replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:bg-zinc-800">$1</code>')
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/^\- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
		.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm">$1</li>')
		.replace(/\n\n/g, '<br/><br/>')

	return (
		<div
			className='prose prose-sm dark:prose-invert max-w-none'
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}

export default function GuidesPage() {
	const [guides, setGuides] = useState<GuideMeta[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [activeTab, setActiveTab] = useState<TabKey>('attack-guides')
	const [searchQuery, setSearchQuery] = useState('')
	const [selectedGuide, setSelectedGuide] = useState<GuideContent | null>(null)
	const [isLoadingContent, setIsLoadingContent] = useState(false)

	const fetchGuides = async (showLoader = false) => {
		if (showLoader) setIsLoading(true)
		try {
			const response = await fetch('/api/guides', { cache: 'no-store' })
			if (!response.ok) throw new Error('Failed to load guides')
			const data = (await response.json()) as GuideMeta[]
			setGuides(data)
		} catch {
			toast.error('Failed to load guides catalog')
		} finally {
			setIsLoading(false)
		}
	}

	const openGuide = async (slug: string, type: TabKey) => {
		setIsLoadingContent(true)
		try {
			const response = await fetch(`/api/guides/${type}/${slug}`, { cache: 'no-store' })
			if (!response.ok) throw new Error('Guide not found')
			const data = (await response.json()) as GuideContent
			setSelectedGuide(data)
		} catch {
			toast.error('Failed to load guide')
		} finally {
			setIsLoadingContent(false)
		}
	}

	useEffect(() => {
		void fetchGuides(true)
	}, [])

	const normalizedQuery = searchQuery.trim().toLowerCase()
	const filteredGuides = useMemo(
		() =>
			guides.filter(g => {
				const hasContent =
					activeTab === 'attack-guides' ? g.hasAttackGuide : g.hasDefensePlaybook
				if (!hasContent) return false
				if (normalizedQuery.length === 0) return true
				return (
					g.service.toLowerCase().includes(normalizedQuery) ||
					g.slug.toLowerCase().includes(normalizedQuery) ||
					(g.cve?.toLowerCase().includes(normalizedQuery) ?? false) ||
					g.tactic.toLowerCase().includes(normalizedQuery) ||
					g.category.toLowerCase().includes(normalizedQuery)
				)
			}),
		[guides, activeTab, normalizedQuery],
	)

	const statsSidebar = (
		<>
			<p className='mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
				Guide Stats
			</p>
			<div className='space-y-2 text-sm'>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>Attack Guides</span>
					<Badge variant='secondary'>
						{guides.filter(g => g.hasAttackGuide).length}
					</Badge>
				</div>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>Defense Playbooks</span>
					<Badge variant='secondary'>
						{guides.filter(g => g.hasDefensePlaybook).length}
					</Badge>
				</div>
				<div className='flex items-center justify-between px-3 py-1'>
					<span className='text-muted-foreground'>Services Covered</span>
					<Badge variant='secondary'>{guides.length}</Badge>
				</div>
			</div>
		</>
	)

	if (selectedGuide) {
		return (
			<SharedLayout>
				<div className='space-y-4'>
					<div className='flex items-center gap-3'>
						<Button
							size='sm'
							variant='outline'
							onClick={() => setSelectedGuide(null)}
						>
							<ArrowLeft className='mr-1 h-3.5 w-3.5' />
							Back to Guides
						</Button>
						<div className='flex items-center gap-2'>
							<Badge variant='secondary' className={severityStyles[selectedGuide.meta.severity] ?? ''}>
								{selectedGuide.meta.severity}
							</Badge>
							{selectedGuide.meta.cve && (
								<Badge variant='secondary' className='font-mono text-[11px]'>
									{selectedGuide.meta.cve}
								</Badge>
							)}
							<Badge variant='secondary' className='border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'>
								{selectedGuide.meta.technique}
							</Badge>
						</div>
					</div>

					{/* Cross-reference link */}
					<div className='flex gap-2'>
						{activeTab === 'attack-guides' && selectedGuide.meta.hasDefensePlaybook && (
							<Button
								size='sm'
								variant='outline'
								onClick={() => {
									setActiveTab('defense-playbooks')
									void openGuide(selectedGuide.meta.slug, 'defense-playbooks')
								}}
							>
								<Shield className='mr-1 h-3.5 w-3.5' />
								View Defense Playbook
							</Button>
						)}
						{activeTab === 'defense-playbooks' && selectedGuide.meta.hasAttackGuide && (
							<Button
								size='sm'
								variant='outline'
								onClick={() => {
									setActiveTab('attack-guides')
									void openGuide(selectedGuide.meta.slug, 'attack-guides')
								}}
							>
								<Swords className='mr-1 h-3.5 w-3.5' />
								View Attack Guide
							</Button>
						)}
					</div>

					<Card className='border-zinc-200/60 dark:border-zinc-800'>
						<CardContent className='pt-6'>
							<SimpleMarkdown content={selectedGuide.content} />
						</CardContent>
					</Card>
				</div>
			</SharedLayout>
		)
	}

	return (
		<SharedLayout sidebar={statsSidebar}>
			<div className='space-y-6'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h2 className='text-lg font-semibold tracking-tight'>
							Security Guides
						</h2>
						<p className='text-sm text-muted-foreground'>
							Attack scenarios and defense playbooks for all lab services.
						</p>
					</div>
					<IconButton
						variant='outline'
						size='sm'
						aria-label='Refresh'
						onClick={() => void fetchGuides()}
						disabled={isLoading}
						icon={<RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />}
					/>
				</div>

				{/* Tabs */}
				<div className='flex gap-2 border-b border-zinc-200/60 dark:border-zinc-800'>
					<button
						type='button'
						onClick={() => setActiveTab('attack-guides')}
						className={cn(
							'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
							activeTab === 'attack-guides'
								? 'border-primary text-primary'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						<Swords className='h-4 w-4' />
						Attack Guides
					</button>
					<button
						type='button'
						onClick={() => setActiveTab('defense-playbooks')}
						className={cn(
							'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
							activeTab === 'defense-playbooks'
								? 'border-primary text-primary'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						<Shield className='h-4 w-4' />
						Defense Playbooks
					</button>
				</div>

				{/* Search */}
				<div className='relative'>
					<Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						placeholder='Search by service, CVE, tactic...'
						value={searchQuery}
						onChange={e => setSearchQuery(e.target.value)}
						className='pl-10'
					/>
				</div>

				{/* Guide cards */}
				{isLoading ? (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						{Array.from({ length: 6 }).map((_, i) => (
							<Card key={`skel-${i}`} className='border-zinc-200/60 dark:border-zinc-800'>
								<CardHeader><Skeleton className='h-5 w-40' /></CardHeader>
								<CardContent><Skeleton className='h-16 w-full' /></CardContent>
							</Card>
						))}
					</div>
				) : filteredGuides.length === 0 ? (
					<Card className='border-zinc-200/60 dark:border-zinc-800'>
						<CardContent className='pt-6'>
							<p className='text-sm text-muted-foreground'>
								No guides match the search.
							</p>
						</CardContent>
					</Card>
				) : (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						{filteredGuides.map(guide => {
							const sevStyle = severityStyles[guide.severity] ?? severityStyles.medium

							return (
								<Card
									key={guide.slug}
									className='cursor-pointer border-zinc-200/60 transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:hover:border-zinc-700'
									onClick={() => void openGuide(guide.slug, activeTab)}
								>
									<CardHeader className='pb-2'>
										<div className='flex items-center justify-between gap-3'>
											<CardTitle className='text-base'>
												{guide.service}
											</CardTitle>
											<Badge variant='secondary' className={cn('text-[11px]', sevStyle)}>
												{guide.severity}
											</Badge>
										</div>
									</CardHeader>
									<CardContent className='space-y-2'>
										{guide.cve && (
											<Badge variant='secondary' className='font-mono text-[11px]'>
												<AlertTriangle className='mr-1 h-3 w-3' />
												{guide.cve}
											</Badge>
										)}

										<div className='flex flex-wrap gap-1.5'>
											<Badge variant='secondary' className='capitalize text-[11px]'>
												{guide.category}
											</Badge>
											<Badge
												variant='secondary'
												className='border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-700 dark:text-violet-300'
											>
												{guide.tactic} / {guide.technique}
											</Badge>
											<Badge variant='secondary' className='font-mono text-[11px]'>
												:{guide.port}
											</Badge>
										</div>

										<div className='flex gap-2 pt-1'>
											{guide.hasAttackGuide && (
												<span className='text-[11px] text-rose-600 dark:text-rose-400'>
													<Swords className='mr-0.5 inline h-3 w-3' />
													Attack
												</span>
											)}
											{guide.hasDefensePlaybook && (
												<span className='text-[11px] text-blue-600 dark:text-blue-400'>
													<Shield className='mr-0.5 inline h-3 w-3' />
													Defense
												</span>
											)}
										</div>
									</CardContent>
								</Card>
							)
						})}
					</div>
				)}

				{isLoadingContent && (
					<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'>
						<Card className='px-8 py-6'>
							<div className='flex items-center gap-3'>
								<Loader2 className='h-5 w-5 animate-spin' />
								<p className='text-sm'>Loading guide...</p>
							</div>
						</Card>
					</div>
				)}
			</div>
		</SharedLayout>
	)
}
