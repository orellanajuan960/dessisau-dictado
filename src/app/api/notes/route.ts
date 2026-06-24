import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  try {
    const notes = await db.note.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(notes)
  } catch (error) {
    console.error('Error fetching notes:', error)
    return NextResponse.json({ error: 'Error al obtener las notas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { content, title } = body

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: 'El contenido es obligatorio' }, { status: 400 })
    }

    const note = await db.note.create({
      data: {
        content: content.trim(),
        title: title?.trim() || null,
      },
    })

    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    console.error('Error creating note:', error)
    return NextResponse.json({ error: 'Error al guardar la nota' }, { status: 500 })
  }
}