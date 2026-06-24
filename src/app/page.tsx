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
  Clock, CalendarDays, X, MapPin, GitBranch, Download, Eraser,
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
    // "fecha 20 06 2026" or "fecha 20/06/2026" (only with "fecha" prefix to avoid false positives)
    {
      re: /fecha\s+(\d{1,2})[\s./\-]+(\d{1,2})[\s./\-]+(\d{2,4})/i,
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

const SPANISH_NUMBERS: Record<string, string> = {
  uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10',
  once: '11', doce: '12', trece: '13', catorce: '14', quince: '15',
  dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20',
  veintiuno: '21', veintidos: '22', veintitres: '23', veinticuatro: '24', veinticinco: '25',
  treinta: '30', cuarenta: '40', cincuenta: '50', sesenta: '60', setenta: '70',
  ochenta: '80', noventa: '90', cien: '100',
}

function parseAxisFromText(text: string): { value: string; match: string } | null {
  // "eje 3", "eje número 3", "eje tres"
  const match = text.match(/eje\s+(?:n[uú]mero\s+)?(\d+|[a-záéíóúñ]+)/i)
  if (match) {
    const raw = match[1].toLowerCase().trim()
    const numeric = SPANISH_NUMBERS[raw] || (/^\d+$/.test(raw) ? raw : null)
    if (numeric) return { value: numeric, match: match[0] }
  }
  return null
}

function parseAddressFromText(text: string): { value: string; match: string } | null {
  // "direccion santa rosa de cua", "dirección av. bolívar"
  const match = text.match(/direcci[oó]n\s+(.+)/i)
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
// VOICE COMMANDS
// ─────────────────────────────────────────────

type VoiceCommand = 'clear' | 'deleteLastWord' | 'deleteLastLine' | 'save' | 'pause' | null

function detectVoiceCommand(text: string): VoiceCommand {
  const lower = text.toLowerCase().trim()

  // Clear text commands
  if (/^borrar\s+(?:la\s+)?(?:caja\s+de\s+)?texto/.test(lower) ||
      /^limpiar\s+(?:la\s+)?(?:caja\s+de\s+)?texto/.test(lower) ||
      /^borrar\s+todo/.test(lower)) {
    return 'clear'
  }

  // Delete last word
  if (/borrar\s+(?:la\s+)?[úu]ltima\s+palabra/.test(lower)) {
    return 'deleteLastWord'
  }

  // Delete last line
  if (/borrar\s+(?:la\s+)?[úu]ltima\s+l[ií]nea/.test(lower)) {
    return 'deleteLastLine'
  }

  // Save (must be standalone)
  if (/^guarda?r(?:\s+nota)?$/.test(lower)) {
    return 'save'
  }

  // Pause
  if (/^pausa(?:r)?$/.test(lower)) {
    return 'pause'
  }

  return null
}

// ─────────────────────────────────────────────
// EXPORT: genera Word con tabla de notas
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

  // Views & data
  const [notes, setNotes] = useState<Note[]>([])
  const [currentView, setCurrentView] = useState<View>('dictation')
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Refs for stable access in speech callbacks (avoids stale closures)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef('')
  const isRecordingRef = useRef(false)
  const fieldsRef = useRef({ title: '', date: '', axis: '', address: '' })
  const saveNoteRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const { toast } = useToast()

  // Keep refs in sync with state
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  useEffect(() => {
    fieldsRef.current = { title: noteTitle, date: noteDate, axis: noteAxis, address: noteAddress }
  }, [noteTitle, noteDate, noteAxis, noteAddress])

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

  // ─── Helper: strip detected patterns from a text chunk ───
  // Always parses and overwrites (no flags — allows re-detection)
  const stripPatterns = useCallback((text: string): string => {
    let cleaned = text
    const dr = parseDateFromText(cleaned)
    if (dr) { setNoteDate(dateToInputValue(dr.date)); cleaned = cleaned.replace(dr.match, ' ') }
    const ar = parseAxisFromText(cleaned)
    if (ar) { setNoteAxis(ar.value); cleaned = cleaned.replace(ar.match, ' ') }
    const adr = parseAddressFromText(cleaned)
    if (adr) { setNoteAddress(adr.value); cleaned = cleaned.replace(adr.match, ' ') }
    return cleaned.replace(/\s{2,}/g, ' ').trim()
  }, [])

  // ─── Helper: stop recognition and prevent restart ───
  const haltRecognition = useCallback(() => {
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null }
    if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null }
    isRecordingRef.current = false
    setIsRecording(false)
    setInterimText('')
  }, [])

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

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const raw = (result[0].transcript + ' ').trim()

          // ── Voice commands ──
          const cmd = detectVoiceCommand(raw)
          if (cmd === 'clear') {
            transcriptRef.current = ''
            setTranscript('')
            return
          }
          if (cmd === 'deleteLastWord') {
            const current = transcriptRef.current.trim()
            const words = current.split(/\s+/)
            words.pop()
            const updated = words.join(' ')
            transcriptRef.current = updated
            setTranscript(updated)
            return
          }
          if (cmd === 'deleteLastLine') {
            const current = transcriptRef.current.trimEnd()
            const lines = current.split('\n')
            lines.pop()
            const updated = lines.join('\n')
            transcriptRef.current = updated
            setTranscript(updated)
            return
          }
          if (cmd === 'save') {
            haltRecognition()
            // Defer save to let React flush state updates
            setTimeout(() => saveNoteRef.current(), 100)
            return
          }
          if (cmd === 'pause') {
            haltRecognition()
            return
          }

          // ── No command: process as dictation ──
          const cleaned = stripPatterns(raw)
          if (cleaned.length > 0) {
            const current = transcriptRef.current
            const updated = current + (current ? ' ' : '') + cleaned
            transcriptRef.current = updated
            setTranscript(updated)
          }
        } else {
          interim += result[0].transcript
        }
      }
      setInterimText(interim)
    }

    recognition.onerror = (event: { error: string }) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        setRecognitionError('Permiso de micrófono denegado.')
        isRecordingRef.current = false
        setIsRecording(false)
      } else if (event.error === 'no-speech' && isRecordingRef.current) {
        restartTimeoutRef.current = setTimeout(() => {
          try { recognition.start() } catch { /* ignore */ }
        }, 500)
      } else if (event.error === 'network') {
        setRecognitionError('Error de red. Verifica tu conexión.')
        isRecordingRef.current = false
        setIsRecording(false)
      }
    }

    recognition.onend = () => {
      if (isRecordingRef.current) {
        restartTimeoutRef.current = setTimeout(() => {
          try { recognition.start() } catch { /* ignore */ }
        }, 300)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      isRecordingRef.current = true
      setIsRecording(true)
      setRecognitionError('')
    } catch {
      toast({ title: 'Error', description: 'No se pudo iniciar el reconocimiento de voz.', variant: 'destructive' })
    }
  }, [toast, stripPatterns, haltRecognition])

  const stopRecognition = useCallback(() => {
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null }
    isRecordingRef.current = false
    setIsRecording(false)
    setInterimText('')
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) { stopRecognition() } else { startRecognition() }
  }, [isRecording, startRecognition, stopRecognition])

  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
      if (recognitionRef.current) recognitionRef.current.stop()
    }
  }, [])

  // ─── Reset form ───
  const resetForm = useCallback(() => {
    setTranscript('')
    transcriptRef.current = ''
    setNoteTitle('')
    setNoteDate('')
    setNoteAxis('')
    setNoteAddress('')
    fieldsRef.current = { title: '', date: '', axis: '', address: '' }
    setShowTitleInput(false)
    setShowFields(false)
  }, [])

  // ─── Save note (reads from refs so it works from both UI and voice command) ───
  const saveNote = useCallback(async () => {
    const content = transcriptRef.current.trim()
    if (!content) {
      toast({ title: 'Nota vacía', description: 'Dicta algo antes de guardar.', variant: 'destructive' })
      return
    }

    const { title, date, axis, address } = fieldsRef.current

    setIsSaving(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          title: title.trim() || null,
          noteDate: date || null,
          axis: axis.trim() || null,
          address: address.trim() || null,
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
  }, [toast, fetchNotes, resetForm])

  // Keep saveNoteRef in sync
  useEffect(() => { saveNoteRef.current = saveNote }, [saveNote])

  // ─── Clear text ───
  const clearText = useCallback(() => {
    transcriptRef.current = ''
    setTranscript('')
  }, [])

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
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">Dictado de Voz</h1>
        <Button variant="ghost" size="sm" onClick={() => { setCurrentView('list'); fetchNotes() }} className="gap-1.5 text-sm">
          <FileText className="h-4 w-4" />
          Mis Notas
          {notes.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{notes.length}</Badge>}
        </Button>
      </div>

      {/* Not supported */}
      {!isSupported && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-3">
            <p className="text-xs text-destructive font-medium">Tu navegador no soporta reconocimiento de voz. Usa Chrome o Safari.</p>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {recognitionError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-3 flex items-start justify-between gap-2">
            <p className="text-xs text-destructive">{recognitionError}</p>
            <Button variant="ghost" size="sm" onClick={() => setRecognitionError('')} className="shrink-0"><X className="h-3.5 w-3.5" /></Button>
          </CardContent>
        </Card>
      )}

      {/* Title input */}
      {showTitleInput && (
        <Input placeholder="Título (opcional)" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} className="text-base" autoFocus />
      )}

      {/* Metadata fields panel */}
      {showFields && (
        <div className="flex flex-col gap-1.5 p-2.5 bg-muted/40 rounded-lg border">
          {/* Date */}
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="text-sm flex-1 h-9" />
            {noteDate && (
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setNoteDate('')}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
          {/* Axis */}
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input placeholder="Eje (ej: 3)" value={noteAxis} onChange={(e) => setNoteAxis(e.target.value)} className="text-sm flex-1 h-9" />
            {noteAxis && (
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setNoteAxis('')}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
          {/* Address */}
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input placeholder="Dirección" value={noteAddress} onChange={(e) => setNoteAddress(e.target.value)} className="text-sm flex-1 h-9" />
            {noteAddress && (
              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setNoteAddress('')}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Detected fields banner (when panel is closed) */}
      {!showFields && activeFieldCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs cursor-pointer" onClick={() => setShowFields(true)}>
          {noteDate && (
            <span className="flex items-center gap-1 text-primary">
              <CalendarDays className="h-3 w-3" />{formatDateShort(noteDate)}
            </span>
          )}
          {noteAxis && (
            <span className="flex items-center gap-1 text-primary">
              <GitBranch className="h-3 w-3" />Eje {noteAxis}
            </span>
          )}
          {noteAddress && (
            <span className="flex items-center gap-1 text-primary">
              <MapPin className="h-3 w-3" />{noteAddress}
            </span>
          )}
          <span className="text-muted-foreground ml-1">tocar para editar</span>
        </div>
      )}

      {/* Text area with clear button */}
      <div className="flex-1 min-h-0 relative">
        <div className="relative h-full">
          <Textarea
            ref={textareaRef}
            value={displayText}
            onChange={(e) => { if (!isRecording) { const v = e.target.value; transcriptRef.current = v; setTranscript(v) } }}
            placeholder={isRecording ? 'Escuchando... Habla ahora' : 'Presiona el micrófono para empezar a dictar...'}
            className="w-full h-full min-h-[180px] md:min-h-[300px] resize-none text-base leading-relaxed pr-10"
            readOnly={isRecording}
          />
          {transcript.length > 0 && !isRecording && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={clearText}
              title="Limpiar texto"
            >
              <Eraser className="h-4 w-4" />
            </Button>
          )}
          {interimText && isRecording && (
            <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Reconociendo...
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2 pt-1 pb-safe">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={() => setShowTitleInput(!showTitleInput)} className="text-xs text-muted-foreground h-8 px-2">
            {showTitleInput ? 'Ocultar título' : 'Título'}
          </Button>
          <span className="text-muted-foreground/30 mx-0.5">|</span>
          <Button variant="ghost" size="sm" onClick={() => setShowFields(!showFields)} className="text-xs text-muted-foreground h-8 px-2">
            {showFields ? 'Ocultar campos' : activeFieldCount > 0 ? `Campos (${activeFieldCount})` : 'Campos'}
          </Button>
        </div>
        <Button onClick={saveNote} disabled={!transcript.trim() || isSaving} className="gap-1.5 h-9 px-4" size="sm">
          <Save className="h-4 w-4" />
          {isSaving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>

      {/* Voice commands help */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/60 px-1">
        <span>&quot;Guardar&quot; = guardar y cerrar</span>
        <span>&quot;Pausa&quot; = detener micrófono</span>
        <span>&quot;Borrar caja de texto&quot; = limpiar</span>
        <span>&quot;Borrar la última palabra&quot;</span>
      </div>

      {/* Floating mic button */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 md:static md:translate-x-0 md:z-auto md:mx-auto md:mb-0 pb-safe">
        <Button
          onClick={toggleRecording}
          disabled={!isSupported}
          size="lg"
          className={`rounded-full w-14 h-14 md:w-18 md:h-18 shadow-xl transition-all duration-300 ${
            isRecording ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
        >
          {isRecording ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </Button>
        <p className="text-center text-[10px] text-muted-foreground mt-1">
          {isRecording ? 'Toca para detener' : 'Toca para dictar'}
        </p>
      </div>
    </div>
  )

  // ==================== NOTES LIST VIEW ====================
  const renderListView = () => (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setCurrentView('dictation')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold tracking-tight">Mis Notas</h1>
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
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-10">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-medium text-muted-foreground">No hay notas</p>
            <p className="text-sm text-muted-foreground mt-1">Dicta tu primera nota presionando el micrófono.</p>
          </div>
          <Button onClick={() => setCurrentView('dictation')} variant="outline" className="gap-2">
            <Mic className="h-4 w-4" />
            Empezar a dictar
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="flex flex-col gap-2.5 pb-4">
            {notes.map((note) => (
              <Card
                key={note.id}
                className="cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98] transition-transform"
                onClick={() => { setSelectedNote(note); setCurrentView('detail') }}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {note.title && <h3 className="font-semibold text-sm truncate">{note.title}</h3>}
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{getPreview(note.content)}</p>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                        {note.noteDate && (
                          <span className="flex items-center gap-0.5"><CalendarDays className="h-3 w-3" />{formatDateShort(note.noteDate)}</span>
                        )}
                        {note.axis && (
                          <span className="flex items-center gap-0.5"><GitBranch className="h-3 w-3" />Eje {note.axis}</span>
                        )}
                        {note.address && (
                          <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{note.address}</span>
                        )}
                        <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDate(note.createdAt)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive h-8 w-8"
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
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedNote(null); setCurrentView('list') }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            {selectedNote.title && <h1 className="text-base font-bold truncate">{selectedNote.title}</h1>}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              {selectedNote.noteDate && <span className="flex items-center gap-0.5"><CalendarDays className="h-3 w-3" />{formatDateShort(selectedNote.noteDate)}</span>}
              {selectedNote.axis && <span className="flex items-center gap-0.5"><GitBranch className="h-3 w-3" />Eje {selectedNote.axis}</span>}
              {selectedNote.address && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{selectedNote.address}</span>}
              <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDate(selectedNote.createdAt)}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(selectedNote.id)}>
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>

        <Separator />

        {/* Metadata card */}
        {(selectedNote.noteDate || selectedNote.axis || selectedNote.address) && (
          <div className="grid grid-cols-3 gap-1.5">
            {selectedNote.noteDate && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/50 rounded-lg text-xs">
                <CalendarDays className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate">{formatDateShort(selectedNote.noteDate)}</span>
              </div>
            )}
            {selectedNote.axis && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/50 rounded-lg text-xs">
                <GitBranch className="h-3 w-3 text-primary shrink-0" />
                <span>Eje {selectedNote.axis}</span>
              </div>
            )}
            {selectedNote.address && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/50 rounded-lg text-xs col-span-3">
                <MapPin className="h-3 w-3 text-primary shrink-0" />
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
        <div className="max-w-lg mx-auto px-3 py-2.5 flex items-center gap-2 pt-safe">
          <Mic className="h-4.5 w-4.5 text-primary" />
          <span className="font-semibold text-sm">VoiceNotes</span>
          {isRecording && (
            <Badge variant="destructive" className="animate-pulse ml-auto text-xs">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-1" />
              Grabando
            </Badge>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-lg mx-auto w-full px-3 py-3 pb-28 md:pb-4">
        {currentView === 'dictation' && renderDictationView()}
        {currentView === 'list' && renderListView()}
        {currentView === 'detail' && renderDetailView()}
      </main>
    </div>
  )
}