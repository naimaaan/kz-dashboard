import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Sonner } from '@/components/ui/sonner'

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
			<body suppressHydrationWarning>
				<ThemeProvider attribute='class' defaultTheme='system' enableSystem>
					{children}
					<Sonner />
				</ThemeProvider>
			</body>
		</html>
	)
}
