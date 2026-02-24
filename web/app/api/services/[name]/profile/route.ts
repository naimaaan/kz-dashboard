import { NextResponse } from 'next/server'

const BACKEND =
	process.env.BACKEND_URL ||
	process.env.NEXT_PUBLIC_API_BASE ||
	'http://localhost:3001'

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params

	try {
		const body = await request.json()

		const response = await fetch(
			`${BACKEND}/services/${encodeURIComponent(name)}/profile`,
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				cache: 'no-store',
			},
		)

		const responseBody = await response.text()

		return new NextResponse(responseBody, {
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
