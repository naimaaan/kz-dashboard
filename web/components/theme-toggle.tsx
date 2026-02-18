'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { IconButton } from '@/components/ui/icon-button'

export function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme()

	const isDark = resolvedTheme === 'dark'

	return (
		<IconButton
			type='button'
			variant='outline'
			size='sm'
			onClick={() => setTheme(isDark ? 'light' : 'dark')}
			aria-label='Toggle theme'
			icon={isDark ? <Sun className='h-4 w-4' /> : <Moon className='h-4 w-4' />}
		></IconButton>
	)
}
