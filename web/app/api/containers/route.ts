import { NextResponse } from 'next/server'

export async function GET() {
	const response = await fetch('http://dashboard-api:3001/containers', {
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
