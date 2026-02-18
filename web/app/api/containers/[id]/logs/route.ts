import { NextResponse } from 'next/server'

const BACKEND =
	process.env.BACKEND_URL ||
	process.env.NEXT_PUBLIC_API_BASE ||
	'http://localhost:3001'

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params
	const { searchParams } = new URL(request.url)
	const tail = searchParams.get('tail') ?? '200'

	try {
		const response = await fetch(
			`${BACKEND}/containers/${id}/logs?tail=${encodeURIComponent(tail)}`,
			{
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
	} catch {
		return NextResponse.json(
			{ message: 'Failed to reach backend service' },
			{ status: 502 },
		)
	}
}
