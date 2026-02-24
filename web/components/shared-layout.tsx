'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
	Boxes,
	FlaskConical,
	Menu,
	Settings,
	Wrench,
} from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet'

interface NavItem {
	href: string
	label: string
	icon: typeof Boxes
}

const navItems: NavItem[] = [
	{ href: '/', label: 'Containers', icon: Boxes },
	{ href: '/services', label: 'Services', icon: Settings },
	{ href: '/exploits', label: 'Exploits', icon: FlaskConical },
]

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
	const Icon = item.icon
	const isActive =
		item.href === '/'
			? pathname === '/'
			: pathname.startsWith(item.href)

	return (
		<Link
			href={item.href}
			className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
				isActive
					? 'bg-accent text-accent-foreground font-medium'
					: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
			}`}
		>
			<Icon className='h-4 w-4' />
			{item.label}
		</Link>
	)
}

export function SharedLayout({
	children,
	sidebar,
}: {
	children: React.ReactNode
	sidebar?: React.ReactNode
}) {
	const pathname = usePathname()

	return (
		<div className='min-h-screen bg-gray-50 dark:bg-zinc-950'>
			<div className='flex min-h-screen'>
				<aside className='sticky top-0 hidden h-screen w-64 shrink-0 border-r border-zinc-200/60 bg-background/90 p-4 dark:border-zinc-800 md:block'>
					<div className='mb-6'>
						<p className='text-xs uppercase tracking-widest text-muted-foreground'>
							KZ Admin
						</p>
						<h2 className='mt-1 text-lg font-semibold'>Dashboard</h2>
					</div>

					<nav className='space-y-1'>
						{navItems.map(item => (
							<NavLink key={item.href} item={item} pathname={pathname} />
						))}
					</nav>

					{sidebar && (
						<div className='mt-6 border-t pt-4'>{sidebar}</div>
					)}
				</aside>

				<div className='flex min-w-0 flex-1 flex-col'>
					<header className='sticky top-0 z-20 border-b border-zinc-200/60 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80 dark:border-zinc-800'>
						<div className='mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6'>
							<div className='flex min-w-0 items-center gap-2'>
								<Sheet>
									<SheetTrigger asChild>
										<Button variant='outline' size='sm' className='md:hidden'>
											<Menu className='h-4 w-4' />
										</Button>
									</SheetTrigger>
									<SheetContent className='max-w-xs p-4'>
										<SheetHeader>
											<SheetTitle>Navigation</SheetTitle>
											<SheetDescription>Quick access sections</SheetDescription>
										</SheetHeader>
										<nav className='mt-5 space-y-1'>
											{navItems.map(item => (
												<NavLink
													key={item.href}
													item={item}
													pathname={pathname}
												/>
											))}
										</nav>
										{sidebar && (
											<div className='mt-5 border-t pt-4'>{sidebar}</div>
										)}
									</SheetContent>
								</Sheet>
								<div className='min-w-0'>
									<h1 className='truncate text-2xl font-semibold'>
										KZ-Sploitable Dashboard
									</h1>
								</div>
							</div>

							<div className='flex shrink-0 items-center gap-3'>
								<ThemeToggle />
							</div>
						</div>
					</header>

					<main className='mx-auto w-full max-w-7xl px-4 py-6 md:px-6'>
						{children}
					</main>
				</div>
			</div>
		</div>
	)
}
