import { NextResponse } from 'next/server'

const allowedActions = new Set(['start', 'stop', 'restart'])
const BACKEND =
	process.env.BACKEND_URL ||
	process.env.NEXT_PUBLIC_API_BASE ||
	'http://localhost:3001'

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ id: string; action: string }> },
) {
	const { id, action } = await params

	if (!allowedActions.has(action)) {
		return NextResponse.json({ message: 'Invalid action' }, { status: 400 })
	}

	const response = await fetch(`${BACKEND}/containers/${id}/${action}`, {
		method: 'POST',
		cache: 'no-store',
	})

	const body = await response.text()

	return new NextResponse(body, {
		status: response.status,
		headers: {
			'content-type':
				response.headers.get('content-type') ?? 'application/json',
		},
	})
}
