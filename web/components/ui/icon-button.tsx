import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface IconButtonProps extends Omit<ButtonProps, 'children'> {
	icon: React.ReactNode
}

export function IconButton({
	icon,
	className,
	size = 'sm',
	...props
}: IconButtonProps) {
	return (
		<Button size={size} className={cn('h-8 w-8 p-0', className)} {...props}>
			{icon}
		</Button>
	)
}
