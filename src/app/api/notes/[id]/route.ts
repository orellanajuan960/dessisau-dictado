import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const note = await db.note.delete({
      where: { id },
    })

    return NextResponse.json(note)
  } catch (error) {
    console.error('Error deleting note:', error)
    return NextResponse.json({ error: 'Error al eliminar la nota' }, { status: 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const note = await db.note.findUnique({
      where: { id },
    })

    if (!note) {
      return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
    }

    return NextResponse.json(note)
  } catch (error) {
    console.error('Error fetching note:', error)
    return NextResponse.json({ error: 'Error al obtener la nota' }, { status: 500 })
  }
}