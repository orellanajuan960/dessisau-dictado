'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import {
  Mic, MicOff, Save, Trash2, FileText, ArrowLeft, Plus,
  Clock, CalendarDays, X, MapPin, GitBranch, Download,
} from 'lucide-react'

type SpeechRecognitionInstance = any

interface Note {
  id: string
  title: string | null
  content: string
  noteDate: string | null
  axis: string | null
  address: string | null
  createdAt: string
  updatedAt: string
}

type View = 'dictation' | 'list' | 'detail'

// ─────────────────────────────────────────────
// PARSERS: extraen datos del texto dictado
// ─────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}

function parseDateFromText(text: string): { date: Date; match: string } | null {
  const patterns: { re: RegExp; extractor: (m: RegExpMatchArray) => Date | null }[] = [
    // "fecha 24 de junio del 2026" or "24 de junio del 2026"
    {
      re: /(?:fecha\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:del?\s+)?(\d{2,4})/i,
      extractor: (m) => {
        const day = parseInt(m[1], 10)
        const month = MONTH_NAMES[m[2].toLowerCase()]
        let year = parseInt(m[3], 10)
        if (year < 100) year += 2000
        if (month === undefined) return null
        const d = new Date(year, month, day)
        return isNaN(d.getTime()) ? null : d
      },
    },
    // "20 06 2026" or "20/06/2026" or "20-06-2026"
    {
      re: /(\d{1,2})[\s./\-]+(\d{1,2})[\s./\-]+(\d{2,4})/,
      extractor: (m) => {
        const a = parseInt(m[1], 10)
        const b = parseInt(m[2], 10)
        let c = parseInt(m[3], 10)
        if (c < 100) c += 2000
        const d1 = new Date(c, b - 1, a)
        const d2 = new Date(c, a - 1, b)
        if (!isNaN(d1.getTime()) && d1.getDate() === a && d1.getMonth() === b - 1) return d1
        if (!isNaN(d2.getTime()) && d2.getDate() === b && d2.getMonth() === a - 1) return d2
        return null
      },
    },
  ]

  for (const { re, extractor } of patterns) {
    const match = text.match(re)
    if (match) {
      const date = extractor(match)
      if (date) return { date, match: match[0] }
    }
  }
  return null
}

function parseAxisFromText(text: string): { value: string; match: string } | null {
  // "eje 3", "eje número 3", "eje 10"
  const match = text.match(/eje\s+(?:n[uú]mero\s+)?(\d+)/i)
  if (match) return { value: match[1], match: match[0] }
  return null
}

function parseAddressFromText(text: string): { value: string; match: string } | null {
  // "direccion santa rosa de cua", "dirección av. bolívar"
  const match = text.match(/direccion\s+(.+)/i)
  if (match && match[1].trim().length > 0) {
    return { value: match[1].trim(), match: match[0] }
  }
  return null
}

function dateToInputValue(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ─────────────────────────────────────────────
// EXPORT: genera Word/PDF con tabla de notas
// ─────────────────────────────────────────────

function exportNotes(notes: Note[]) {
  const sorted = [...notes].sort((a, b) => {
    if (a.noteDate && b.noteDate) return new Date(a.noteDate).getTime() - new Date(b.noteDate).getTime()
    if (a.noteDate) return -1
    if (b.noteDate) return 1
    return 0
  })

  const fmtDate = (d: string) => {
    const date = new Date(d)
    return date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const rows = sorted.map((n) => `
    <tr>
      <td style="border:1px solid #333;padding:8px;vertical-align:top;font-size:13px;">${n.noteDate ? fmtDate(n.noteDate) : '-'}</td>
      <td style="border:1px solid #333;padding:8px;vertical-align:top;font-size:13px;text-align:center;">${n.axis || '-'}</td>
      <td style="border:1px solid #333;padding:8px;vertical-align:top;font-size:13px;">${n.address || '-'}</td>
      <td style="border:1px solid #333;padding:8px;vertical-align:top;font-size:13px;">${n.content.replace(/\n/g, '<br>')}</td>
    </tr>
  `).join('')

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h2 { text-align: center; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th { background-color: #222; color: #fff; border: 1px solid #333; padding: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <h2>Notas Dictadas</h2>
  <p style="text-align:center;color:#666;font-size:12px;margin-bottom:16px;">
    Generado el ${new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' })} &mdash; ${sorted.length} nota(s)
  </p>
  <table>
    <thead>
      <tr>
        <th style="width:100px;">Fecha</th>
        <th style="width:60px;">Eje</th>
        <th style="width:180px;">Dirección</th>
        <th>Contenido</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`

  const blob = new Blob(['\ufeff' + html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `notas_dictadas_${new Date().toISOString().slice(0, 10)}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

export default function Home() {
  // Dictation state
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [recognitionError, setRecognitionError] = useState('')
  const [isSupported, setIsSupported] = useState(true)

  // Note fields
  const [noteTitle, setNoteTitle] = useState('')
  const [noteDate, setNoteDate] = useState('')
  const [noteAxis, setNoteAxis] = useState('')
  const [noteAddress, setNoteAddress] = useState('')

  // UI toggles
  const [showTitleInput, setShowTitleInput] = useState(false)
  const [showFields, setShowFields] = useState(false)

  // Detection flags (prevent re-detection)
  const detectedDate = useRef(false)
  const detectedAxis = useRef(false)
  const detectedAddress = useRef(false)

  // Views & data
  const [notes, setNotes] = useState<Note[]>([])
  const [currentView, setCurrentView] = useState<View>('dictation')
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  // ─── Browser support ───
  useEffect(() => {
    const SR =
      typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>).SpeechRecognition ||
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition
        : null
    if (!SR) setIsSupported(false)
  }, [])

  // ─── Fetch notes ───
  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/notes')
      if (res.ok) setNotes(await res.json())
    } catch {
      toast({ title: 'Error', description: 'No se pudieron cargar las notas.', variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // ─── Auto-detect fields from transcript ───
  useEffect(() => {
    if (!transcript.trim()) return
    let cleaned = transcript

    // Detect date
    if (!detectedDate.current) {
      const dateResult = parseDateFromText(cleaned)
      if (dateResult) {
        setNoteDate(dateToInputValue(dateResult.date))
        detectedDate.current = true
        cleaned = cleaned.replace(dateResult.match, '').trim()
      }
    }

    // Detect axis
    if (!detectedAxis.current) {
      const axisResult = parseAxisFromText(cleaned)
      if (axisResult) {
        setNoteAxis(axisResult.value)
        detectedAxis.current = true
        cleaned = cleaned.replace(axisResult.match, '').trim()
      }
    }

    // Detect address
    if (!detectedAddress.current) {
      const addrResult = parseAddressFromText(cleaned)
      if (addrResult) {
        setNoteAddress(addrResult.value)
        detectedAddress.current = true
        cleaned = cleaned.replace(addrResult.match, '').trim()
      }
    }

    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
    if (cleaned !== transcript) {
      setTranscript(cleaned)
    }
  }, [transcript])

  // ─── Speech recognition ───
  const startRecognition = useCallback(() => {
    const SpeechRecognitionAPI =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    const recognition = new (SpeechRecognitionAPI as new () => SpeechRecognitionInstance)()
    recognition.lang = 'es-ES'
    recognition.continuous = true
    recognition.interimResults = true

    let finalTranscript = transcript

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' '
        } else {
          interim += result[0].transcript
        }
      }
      setTranscript(finalTranscript)
      setInterimText(interim)
    }

    recognition.onerror = (event: { error: string }) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        setRecognitionError('Permiso de micrófono denegado.')
        setIsRecording(false)
      } else if (event.error === 'no-speech' && isRecording) {
        restartTimeoutRef.current = setTimeout(() => {
          try { recognition.start() } catch { /* ignore */ }
        }, 500)
      } else if (event.error === 'network') {
        setRecognitionError('Error de red. Verifica tu conexión.')
        setIsRecording(false)
      }
    }

    recognition.onend = () => {
      if (isRecording && !recognitionError) {
        restartTimeoutRef.current = setTimeout(() => {
          try { recognition.start() } catch { /* ignore */ }
        }, 300)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsRecording(true)
      setRecognitionError('')
    } catch {
      toast({ title: 'Error', description: 'No se pudo iniciar el reconocimiento de voz.', variant: 'destructive' })
    }
  }, [transcript, isRecording, recognitionError, toast])

  const stopRecognition = useCallback(() => {
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null }
    setIsRecording(false)
    setInterimText('')
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecording) { stopRecognition() } else { startRecognition() }
  }, [isRecording, startRecognition, stopRecognition])

  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
      if (recognitionRef.current) recognitionRef.current.stop()
    }
  }, [])

  // ─── Save note ───
  const resetForm = () => {
    setTranscript('')
    setNoteTitle('')
    setNoteDate('')
    setNoteAxis('')
    setNoteAddress('')
    setShowTitleInput(false)
    setShowFields(false)
    detectedDate.current = false
    detectedAxis.current = false
    detectedAddress.current = false
  }

  const saveNote = async () => {
    const trimmed = transcript.trim()
    if (!trimmed) {
      toast({ title: 'Nota vacía', description: 'Dicta algo antes de guardar.', variant: 'destructive' })
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trimmed,
          title: noteTitle.trim() || null,
          noteDate: noteDate || null,
          axis: noteAxis.trim() || null,
          address: noteAddress.trim() || null,
        }),
      })

      if (res.ok) {
        toast({ title: 'Nota guardada', description: 'Tu nota se ha guardado exitosamente.' })
        resetForm()
        fetchNotes()
        setCurrentView('list')
      } else {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error || 'Error al guardar')
      }
    } catch (err) {
      toast({
        title: 'Error al guardar',
        description: err instanceof Error ? err.message : 'No se pudo guardar la nota.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Delete note ───
  const deleteNote = async (id: string) => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Eliminada', description: 'La nota ha sido eliminada.' })
        setNotes((prev) => prev.filter((n) => n.id !== id))
        if (selectedNote?.id === id) { setSelectedNote(null); setCurrentView('list') }
      }
    } catch {
      toast({ title: 'Error', description: 'No se pudo eliminar la nota.', variant: 'destructive' })
    }
    setDeleteTarget(null)
  }

  // ─── Formatters ───
  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const formatDateShort = (d: string) => new Date(d).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' })
  const getPreview = (c: string) => c.length > 100 ? c.substring(0, 100) + '...' : c

  const displayText = useMemo(() => {
    const base = transcript.trim()
    const interim = interimText.trim()
    return interim ? base + (base ? ' ' : '') + interim : base
  }, [transcript, interimText])

  // Count active metadata fields
  const activeFieldCount = [noteDate, noteAxis, noteAddress].filter(Boolean).length

  // ==================== DICTATION VIEW ====================
  const renderDictationView = () => (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Dictado de Voz</h1>
        <Button variant="ghost" size="sm" onClick={() => { setCurrentView('list'); fetchNotes() }} className="gap-1.5 text-sm">
          <FileText className="h-4 w-4" />
          Mis Notas
          {notes.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{notes.length}</Badge>}
        </Button>
      </div>

      {/* Not supported */}
      {!isSupported && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4">
            <p className="text-sm text-destructive font-medium">Tu navegador no soporta reconocimiento de voz. Usa Chrome o Safari.</p>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {recognitionError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-start justify-between gap-2">
            <p className="text-sm text-destructive">{recognitionError}</p>
            <Button variant="ghost" size="sm" onClick={() => setRecognitionError('')} className="shrink-0"><X className="h-4 w-4" /></Button>
          </CardContent>
        </Card>
      )}

      {/* Title input */}
      {showTitleInput && (
        <Input placeholder="Título (opcional)" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} className="text-base" autoFocus />
      )}

      {/* Metadata fields panel */}
      {showFields && (
        <div className="flex flex-col gap-2 p-3 bg-muted/40 rounded-lg border">
          {/* Date */}
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input type="date" value={noteDate} onChange={(e) => { setNoteDate(e.target.value); if (e.target.value) detectedDate.current = true }} className="text-sm flex-1" />
            {noteDate && (
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => { setNoteDate(''); detectedDate.current = false }}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
          {/* Axis */}
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input placeholder="Eje (ej: 3)" value={noteAxis} onChange={(e) => { setNoteAxis(e.target.value); if (e.target.value) detectedAxis.current = true }} className="text-sm flex-1" />
            {noteAxis && (
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => { setNoteAxis(''); detectedAxis.current = false }}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
          {/* Address */}
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input placeholder="Dirección (ej: Santa Rosa de Cua)" value={noteAddress} onChange={(e) => { setNoteAddress(e.target.value); if (e.target.value) detectedAddress.current = true }} className="text-sm flex-1" />
            {noteAddress && (
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => { setNoteAddress(''); detectedAddress.current = false }}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Detected fields banner (when panel is closed) */}
      {!showFields && activeFieldCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 rounded-lg text-sm cursor-pointer" onClick={() => setShowFields(true)}>
          {noteDate && (
            <span className="flex items-center gap-1 text-primary">
              <CalendarDays className="h-3.5 w-3.5" />{formatDateShort(noteDate)}
            </span>
          )}
          {noteAxis && (
            <span className="flex items-center gap-1 text-primary">
              <GitBranch className="h-3.5 w-3.5" />Eje {noteAxis}
            </span>
          )}
          {noteAddress && (
            <span className="flex items-center gap-1 text-primary">
              <MapPin className="h-3.5 w-3.5" />{noteAddress}
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-1">tocar para editar</span>
        </div>
      )}

      {/* Text area */}
      <div className="flex-1 min-h-0 relative">
        <Textarea
          ref={textareaRef}
          value={displayText}
          onChange={(e) => { if (!isRecording) setTranscript(e.target.value) }}
          placeholder={isRecording ? 'Escuchando... Habla ahora' : 'Presiona el micrófono para empezar a dictar...'}
          className="w-full h-full min-h-[200px] md:min-h-[300px] resize-none text-base leading-relaxed"
          readOnly={isRecording}
        />
        {interimText && isRecording && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Reconociendo...
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2 pb-safe">
        <div className="flex items-center gap-1 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setShowTitleInput(!showTitleInput)} className="text-xs text-muted-foreground">
            {showTitleInput ? 'Ocultar título' : 'Título'}
          </Button>
          <span className="text-muted-foreground/30">|</span>
          <Button variant="ghost" size="sm" onClick={() => setShowFields(!showFields)} className="text-xs text-muted-foreground">
            {showFields ? 'Ocultar campos' : activeFieldCount > 0 ? `Campos (${activeFieldCount})` : 'Campos'}
          </Button>
        </div>
        <Button onClick={saveNote} disabled={!transcript.trim() || isSaving} className="gap-2" size="lg">
          <Save className="h-4 w-4" />
          {isSaving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>

      {/* Floating mic button */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:static md:translate-x-0 md:z-auto md:mx-auto md:mb-0">
        <Button
          onClick={toggleRecording}
          disabled={!isSupported}
          size="lg"
          className={`rounded-full w-16 h-16 md:w-20 md:h-20 shadow-xl transition-all duration-300 ${
            isRecording ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
        >
          {isRecording ? <MicOff className="h-7 w-7 md:h-8 md:w-8" /> : <Mic className="h-7 w-7 md:h-8 md:w-8" />}
        </Button>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {isRecording ? 'Toca para detener' : 'Toca para dictar'}
        </p>
      </div>
    </div>
  )

  // ==================== NOTES LIST VIEW ====================
  const renderListView = () => (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setCurrentView('dictation')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">Mis Notas</h1>
        </div>
        <div className="flex items-center gap-1">
          {notes.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportNotes(notes)} className="gap-1.5">
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          )}
          <Button onClick={() => { resetForm(); setCurrentView('dictation') }} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nueva
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-medium text-muted-foreground">No hay notas</p>
            <p className="text-sm text-muted-foreground mt-1">Dicta tu primera nota presionando el micrófono.</p>
          </div>
          <Button onClick={() => setCurrentView('dictation')} variant="outline" className="gap-2">
            <Mic className="h-4 w-4" />
            Empezar a dictar
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="flex flex-col gap-3 pb-4">
            {notes.map((note) => (
              <Card
                key={note.id}
                className="cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98] transition-transform"
                onClick={() => { setSelectedNote(note); setCurrentView('detail') }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {note.title && <h3 className="font-semibold text-sm truncate">{note.title}</h3>}
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{getPreview(note.content)}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                        {note.noteDate && (
                          <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDateShort(note.noteDate)}</span>
                        )}
                        {note.axis && (
                          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />Eje {note.axis}</span>
                        )}
                        {note.address && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{note.address}</span>
                        )}
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(note.createdAt)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(note.id) }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar nota</AlertDialogTitle>
            <AlertDialogDescription>¿Estás seguro de que quieres eliminar esta nota? Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteNote(deleteTarget)} className="bg-destructive text-white hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  // ==================== NOTE DETAIL VIEW ====================
  const renderDetailView = () => {
    if (!selectedNote) return null
    return (
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedNote(null); setCurrentView('list') }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            {selectedNote.title && <h1 className="text-lg font-bold truncate">{selectedNote.title}</h1>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {selectedNote.noteDate && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDateShort(selectedNote.noteDate)}</span>}
              {selectedNote.axis && <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />Eje {selectedNote.axis}</span>}
              {selectedNote.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{selectedNote.address}</span>}
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(selectedNote.createdAt)}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(selectedNote.id)}>
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>

        <Separator />

        {/* Metadata card */}
        {(selectedNote.noteDate || selectedNote.axis || selectedNote.address) && (
          <div className="grid grid-cols-3 gap-2">
            {selectedNote.noteDate && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/50 rounded-lg text-sm">
                <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{formatDateShort(selectedNote.noteDate)}</span>
              </div>
            )}
            {selectedNote.axis && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/50 rounded-lg text-sm">
                <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Eje {selectedNote.axis}</span>
              </div>
            )}
            {selectedNote.address && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/50 rounded-lg text-sm col-span-3">
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{selectedNote.address}</span>
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="whitespace-pre-wrap text-base leading-relaxed pb-4">{selectedNote.content}</div>
        </ScrollArea>

        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar nota</AlertDialogTitle>
              <AlertDialogDescription>¿Estás seguro de que quieres eliminar esta nota? Esta acción no se puede deshacer.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteTarget && deleteNote(deleteTarget)} className="bg-destructive text-white hover:bg-destructive/90">Eliminar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Mic className="h-5 w-5 text-primary" />
          <span className="font-semibold text-base">VoiceNotes</span>
          {isRecording && (
            <Badge variant="destructive" className="animate-pulse ml-auto">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-1.5" />
              Grabando
            </Badge>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 pb-24 md:pb-4">
        {currentView === 'dictation' && renderDictationView()}
        {currentView === 'list' && renderListView()}
        {currentView === 'detail' && renderDetailView()}
      </main>
    </div>
  )
}