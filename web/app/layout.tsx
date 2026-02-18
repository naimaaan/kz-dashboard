import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'KZ-Sploitable Dashboard',
	description: 'Docker container management dashboard',
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang='en' suppressHydrationWarning>
			<body suppressHydrationWarning>{children}</body>
		</html>
	)
}
