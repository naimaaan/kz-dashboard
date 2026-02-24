import { NextResponse } from 'next/server'

const BACKEND =
	process.env.BACKEND_URL ||
	process.env.NEXT_PUBLIC_API_BASE ||
	'http://localhost:3001'

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params

	try {
		const response = await fetch(
			`${BACKEND}/services/${encodeURIComponent(name)}/deploy`,
			{ method: 'POST', cache: 'no-store' },
		)

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
