import { NextResponse } from 'next/server'

const allowedActions = new Set(['start', 'stop', 'restart'])

export async function POST(
	_request: Request,
	{ params }: { params: { id: string; action: string } },
) {
	const { id, action } = params

	if (!allowedActions.has(action)) {
		return NextResponse.json({ message: 'Invalid action' }, { status: 400 })
	}

	const response = await fetch(
		`http://dashboard-api:3001/containers/${id}/${action}`,
		{
			method: 'POST',
			cache: 'no-store',
		},
	)

	const body = await response.text()

	return new NextResponse(body, {
		status: response.status,
		headers: {
			'content-type':
				response.headers.get('content-type') ?? 'application/json',
		},
	})
}
