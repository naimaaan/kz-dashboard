import { NextResponse } from 'next/server'

const allowedActions = new Set(['start', 'stop', 'restart'])
const BACKEND =
	process.env.BACKEND_URL ||
	process.env.NEXT_PUBLIC_API_BASE ||
	'http://localhost:3001'

export async function POST(
	request: Request,
	{ params }: { params: { action: string } },
) {
	const { action } = params

	if (!allowedActions.has(action)) {
		return NextResponse.json({ message: 'Invalid action' }, { status: 400 })
	}

	const payload = await request.text()

	const response = await fetch(`${BACKEND}/containers/bulk/${action}`, {
		method: 'POST',
		cache: 'no-store',
		headers: {
			'content-type': 'application/json',
		},
		body: payload,
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
