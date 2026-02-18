'use client'

import type { ComponentProps } from 'react'
import { useTheme } from 'next-themes'
import { Toaster } from 'sonner'

type ToasterProps = ComponentProps<typeof Toaster>

const Sonner = ({ ...props }: ToasterProps) => {
	const { resolvedTheme } = useTheme()

	return (
		<Toaster
			theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
			closeButton
			richColors
			{...props}
		/>
	)
}

export { Sonner }
