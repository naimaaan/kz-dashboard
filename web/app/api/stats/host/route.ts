import { NextResponse } from 'next/server'

const BACKEND =
	process.env.BACKEND_URL ||
	process.env.NEXT_PUBLIC_API_BASE ||
	'http://localhost:3001'

export async function GET() {
	try {
		const response = await fetch(`${BACKEND}/stats/host`, {
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
	} catch {
		return NextResponse.json(
			{ message: 'Failed to reach backend service' },
			{ status: 502 },
		)
	}
}
