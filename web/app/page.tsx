import {
	ContainerDashboard,
	ContainerItem,
} from '@/components/container-dashboard'

async function getContainers(): Promise<ContainerItem[]> {
	const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001'

	const response = await fetch(`${API_BASE}/containers`, {
		cache: 'no-store',
	})

	if (!response.ok) {
		return []
	}

	return (await response.json()) as ContainerItem[]
}

export default async function Page() {
	const containers = await getContainers()

	return (
		<main className='min-h-screen bg-muted/20'>
			<div className='mx-auto max-w-6xl px-6 py-10'>
				<header className='mb-8'>
					<h1 className='text-3xl font-semibold tracking-tight'>
						KZ-Sploitable Dashboard
					</h1>
					<p className='mt-2 text-sm text-muted-foreground'>
						Manage Docker containers on the remote host.
					</p>
				</header>
				<ContainerDashboard initialContainers={containers} />
			</div>
		</main>
	)
}
