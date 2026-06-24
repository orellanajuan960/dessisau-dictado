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
  Clock, CalendarDays, X, MapPin, GitBranch, Download, Eraser, ChevronDown,
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
// RAW TRANSCRIPT FIELD EXTRACTOR
// Scans the FULL accumulated text so split chunks still match
// ─────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}

const SPANISH_NUMBERS: Record<string, string> = {
  uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10',
  once: '11', doce: '12', trece: '13', catorce: '14', quince: '15',
  dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20',
  veintiuno: '21', veintidos: '22', veintitres: '23', veinticuatro: '24', veinticinco: '25',
  veintiseis: '26', veintisiete: '27', veintiocho: '28', veintinueve: '29',
  treinta: '30', cuarenta: '40', cincuenta: '50', sesenta: '60', setenta: '70',
  ochenta: '80', noventa: '90', cien: '100',
}

// Regex patterns (compiled once, reused)
const RE_DATE_NAMED = /fecha\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{2,4})/gi
const RE_DATE_NAMED2 = /fecha\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+del\s+(\d{2,4})/gi
const RE_DATE_NUMERIC = /fecha\s+(\d{1,2})[\s./\-]+(\d{1,2})[\s./\-]+(\d{2,4})/gi
const RE_AXIS = /eje\s+(?:n[uú]mero\s+)?(\d+|[a-záéíóúñ]+)/gi
const RE_ADDRESS = /direcci[oó]n\s+((?:\S+\s*){1,8})/gi

interface FieldResult {
  cleaned: string
  date: string
  axis: string
  address: string
}

function dateToInputValue(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Scans the FULL raw transcript, extracts the LAST match of each field,
 * removes ALL field matches, and returns the cleaned text + field values.
 */
function extractFieldsFromRaw(raw: string): FieldResult {
  let date = ''
  let axis = ''
  let address = ''
  let cleaned = raw

  // --- Date: "fecha 26 de junio de 2026" ---
  RE_DATE_NAMED.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_DATE_NAMED.exec(cleaned)) !== null) {
    const day = parseInt(m[1], 10)
    const month = MONTH_NAMES[m[2].toLowerCase()]
    let year = parseInt(m[3], 10)
    if (year < 100) year += 2000
    if (month !== undefined) {
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) date = dateToInputValue(d)
    }
  }
  cleaned = cleaned.replace(RE_DATE_NAMED, ' ')

  // --- Date: "fecha 26 de junio del 2026" ---
  RE_DATE_NAMED2.lastIndex = 0
  while ((m = RE_DATE_NAMED2.exec(cleaned)) !== null) {
    const day = parseInt(m[1], 10)
    const month = MONTH_NAMES[m[2].toLowerCase()]
    let year = parseInt(m[3], 10)
    if (year < 100) year += 2000
    if (month !== undefined) {
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) date = dateToInputValue(d)
    }
  }
  cleaned = cleaned.replace(RE_DATE_NAMED2, ' ')

  // --- Date: "fecha 20 06 2026" ---
  RE_DATE_NUMERIC.lastIndex = 0
  while ((m = RE_DATE_NUMERIC.exec(cleaned)) !== null) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    let c = parseInt(m[3], 10)
    if (c < 100) c += 2000
    const d1 = new Date(c, b - 1, a)
    if (!isNaN(d1.getTime()) && d1.getDate() === a && d1.getMonth() === b - 1) {
      date = dateToInputValue(d1)
    }
  }
  cleaned = cleaned.replace(RE_DATE_NUMERIC, ' ')

  // --- Axis: "eje 3", "eje número 3", "eje tres" ---
  RE_AXIS.lastIndex = 0
  while ((m = RE_AXIS.exec(cleaned)) !== null) {
    const v = m[1].toLowerCase().trim()
    const num = SPANISH_NUMBERS[v] || (/^\d+$/.test(v) ? v : null)
    if (num) axis = num
  }
  cleaned = cleaned.replace(RE_AXIS, ' ')

  // --- Address: "dirección santa rosa de cua" (up to 8 words) ---
  RE_ADDRESS.lastIndex = 0
  while ((m = RE_ADDRESS.exec(cleaned)) !== null) {
    const v = m[1].trim()
    if (v.length > 0) address = v
  }
  cleaned = cleaned.replace(RE_ADDRESS, ' ')

  return {
    cleaned: cleaned.replace(/\s{2,}/g, ' ').trim(),
    date,
    axis,
    address,
  }
}

// ─────────────────────────────────────────────
// VOICE COMMANDS
// ─────────────────────────────────────────────

type VoiceCommand = 'clear' | 'deleteLastWord' | 'deleteLastLine' | 'save' | 'pause' | null

function detectVoiceCommand(text: string): VoiceCommand {
  const lower = text.toLowerCase().trim()
  if (/^borrar\s+(?:la\s+)?(?:caja\s+de\s+)?texto|^limpiar\s+(?:la\s+)?(?:caja\s+de\s+)?texto|^borrar\s+todo/.test(lower)) return 'clear'
  if (/borrar\s+(?:la\s+)?[úu]ltima\s+palabra/.test(lower)) return 'deleteLastWord'
  if (/borrar\s+(?:la\s+)?[úu]ltima\s+l[ií]nea/.test(lower)) return 'deleteLastLine'
  if (/^guarda?r(?:\s+nota)?$/.test(lower)) return 'save'
  if (/^pausa(?:r)?$/.test(lower)) return 'pause'
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

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })

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
    Generado el ${new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' })} — ${sorted.length} nota(s)
  </p>
  <table>
    <thead><tr>
      <th style="width:100px;">Fecha</th>
      <th style="width:60px;">Eje</th>
      <th style="width:180px;">Dirección</th>
      <th>Contenido</th>
    </tr></thead>
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
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [recognitionError, setRecognitionError] = useState('')
  const [isSupported, setIsSupported] = useState(true)

  const [noteTitle, setNoteTitle] = useState('')
  const [noteDate, setNoteDate] = useState('')
  const [noteAxis, setNoteAxis] = useState('')
  const [noteAddress, setNoteAddress] = useState('')

  const [showTitleInput, setShowTitleInput] = useState(false)
  const [showFields, setShowFields] = useState(false)

  const [notes, setNotes] = useState<Note[]>([])
  const [currentView, setCurrentView] = useState<View>('dictation')
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Refs
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rawTranscriptRef = useRef('')   // raw text BEFORE field removal
  const transcriptRef = useRef('')      // cleaned display text (kept in sync with state)
  const isRecordingRef = useRef(false)
  const fieldsRef = useRef({ title: '', date: '', axis: '', address: '' })
  const saveNoteRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const { toast } = useToast()

  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  useEffect(() => { fieldsRef.current = { title: noteTitle, date: noteDate, axis: noteAxis, address: noteAddress } }, [noteTitle, noteDate, noteAxis, noteAddress])

  useEffect(() => {
    const SR = typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
      : null
    if (!SR) setIsSupported(false)
  }, [])

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/notes')
      if (res.ok) setNotes(await res.json())
    } catch {
      toast({ title: 'Error', description: 'No se pudieron cargar las notas.', variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // ─── Process raw transcript: extract fields, return cleaned text ───
  const processAndSet = useCallback((raw: string) => {
    const result = extractFieldsFromRaw(raw)
    rawTranscriptRef.current = result.cleaned
    transcriptRef.current = result.cleaned
    setTranscript(result.cleaned)
    if (result.date) setNoteDate(result.date)
    if (result.axis) setNoteAxis(result.axis)
    if (result.address) setNoteAddress(result.address)
  }, [])

  // ─── Halt recognition immediately (no restart) ───
  const haltRecognition = useCallback(() => {
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null }
    if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null }
    isRecordingRef.current = false
    setIsRecording(false)
    setInterimText('')
  }, [])

  // ─── Start speech recognition ───
  const startRecognition = useCallback(() => {
    const SpeechRecognitionAPI = typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
      : null
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

          // Voice commands (checked BEFORE adding to transcript)
          const cmd = detectVoiceCommand(raw)
          if (cmd === 'clear') {
            rawTranscriptRef.current = ''
            transcriptRef.current = ''
            setTranscript('')
            return
          }
          if (cmd === 'deleteLastWord') {
            const current = rawTranscriptRef.current.trim()
            const words = current.split(/\s+/)
            words.pop()
            const updated = words.join(' ')
            processAndSet(updated)
            return
          }
          if (cmd === 'deleteLastLine') {
            const current = rawTranscriptRef.current.trimEnd()
            const lines = current.split('\n')
            lines.pop()
            processAndSet(lines.join('\n'))
            return
          }
          if (cmd === 'save') {
            haltRecognition()
            setTimeout(() => saveNoteRef.current(), 150)
            return
          }
          if (cmd === 'pause') {
            haltRecognition()
            return
          }

          // Append raw chunk and re-process the FULL text
          const fullRaw = rawTranscriptRef.current + (rawTranscriptRef.current ? ' ' : '') + raw
          processAndSet(fullRaw)
        } else {
          interim += result[0].transcript
        }
      }
      setInterimText(interim)
    }

    recognition.onerror = (event: { error: string }) => {
      console.error('Speech error:', event.error)
      if (event.error === 'not-allowed') {
        setRecognitionError('Permiso de micrófono denegado.')
        isRecordingRef.current = false
        setIsRecording(false)
      } else if (event.error === 'no-speech' && isRecordingRef.current) {
        restartTimeoutRef.current = setTimeout(() => { try { recognition.start() } catch { /* */ } }, 500)
      } else if (event.error === 'network') {
        setRecognitionError('Error de red.')
        isRecordingRef.current = false
        setIsRecording(false)
      }
    }

    recognition.onend = () => {
      if (isRecordingRef.current) {
        restartTimeoutRef.current = setTimeout(() => { try { recognition.start() } catch { /* */ } }, 300)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      isRecordingRef.current = true
      setIsRecording(true)
      setRecognitionError('')
    } catch {
      toast({ title: 'Error', description: 'No se pudo iniciar el micrófono.', variant: 'destructive' })
    }
  }, [toast, haltRecognition, processAndSet])

  const stopRecognition = useCallback(() => {
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null }
    isRecordingRef.current = false
    setIsRecording(false)
    setInterimText('')
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) { stopRecognition() } else { startRecognition() }
  }, [startRecognition, stopRecognition])

  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
      if (recognitionRef.current) recognitionRef.current.stop()
    }
  }, [])

  const resetForm = useCallback(() => {
    rawTranscriptRef.current = ''
    transcriptRef.current = ''
    setTranscript('')
    setNoteTitle('')
    setNoteDate('')
    setNoteAxis('')
    setNoteAddress('')
    fieldsRef.current = { title: '', date: '', axis: '', address: '' }
    setShowTitleInput(false)
    setShowFields(false)
  }, [])

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
        toast({ title: 'Nota guardada' })
        resetForm()
        fetchNotes()
        setCurrentView('list')
      } else {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error || 'Error al guardar')
      }
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'No se pudo guardar.', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }, [toast, fetchNotes, resetForm])

  useEffect(() => { saveNoteRef.current = saveNote }, [saveNote])

  const deleteNote = async (id: string) => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Eliminada' })
        setNotes((prev) => prev.filter((n) => n.id !== id))
        if (selectedNote?.id === id) { setSelectedNote(null); setCurrentView('list') }
      }
    } catch {
      toast({ title: 'Error', description: 'No se pudo eliminar.', variant: 'destructive' })
    }
    setDeleteTarget(null)
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const formatDateShort = (d: string) => new Date(d).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' })
  const getPreview = (c: string) => c.length > 100 ? c.substring(0, 100) + '...' : c

  const displayText = useMemo(() => {
    const base = transcript.trim()
    const interim = interimText.trim()
    return interim ? base + (base ? ' ' : '') + interim : base
  }, [transcript, interimText])

  const activeFieldCount = [noteDate, noteAxis, noteAddress].filter(Boolean).length

  // ==================== DICTATION VIEW ====================
  const renderDictationView = () => (
    <div className="flex flex-col h-full">
      {/* ── Text area (fills available space) ── */}
      <div className="flex-1 min-h-0 relative">
        <Textarea
          value={displayText}
          onChange={(e) => {
            if (!isRecording) {
              const v = e.target.value
              rawTranscriptRef.current = v
              transcriptRef.current = v
              setTranscript(v)
            }
          }}
          placeholder={isRecording ? 'Escuchando...' : 'Presiona 🎤 para dictar'}
          className="w-full h-full rounded-none border-0 border-b text-[16px] leading-relaxed resize-none bg-transparent px-4 pt-3 pb-2 focus-visible:ring-0"
          readOnly={isRecording}
        />
        {/* Clear button */}
        {transcript.length > 0 && !isRecording && (
          <button
            className="absolute top-2 right-2 p-1.5 rounded-full text-muted-foreground/50 hover:text-destructive active:scale-90 transition-colors"
            onClick={() => { rawTranscriptRef.current = ''; transcriptRef.current = ''; setTranscript('') }}
          >
            <Eraser className="h-4 w-4" />
          </button>
        )}
        {/* Recording indicator */}
        {interimText && isRecording && (
          <div className="absolute bottom-2 left-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            escuchando...
          </div>
        )}
      </div>

      {/* ── Bottom panel ── */}
      <div className="shrink-0 bg-background">
        {/* Detected fields banner (when panel closed) */}
        {!showFields && activeFieldCount > 0 && (
          <div
            className="flex items-center gap-2 px-4 py-1.5 text-xs text-primary border-b cursor-pointer active:bg-muted/50"
            onClick={() => setShowFields(true)}
          >
            {noteDate && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDateShort(noteDate)}</span>}
            {noteAxis && <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />Eje {noteAxis}</span>}
            {noteAddress && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" />{noteAddress}</span>}
          </div>
        )}

        {/* Expandable: Title input */}
        {showTitleInput && (
          <div className="px-4 py-2 border-b">
            <Input
              placeholder="Título (opcional)"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>
        )}

        {/* Expandable: Fields panel */}
        {showFields && (
          <div className="flex flex-col gap-2 px-4 py-2.5 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="text-sm flex-1 h-9" />
              {noteDate && <button className="p-1" onClick={() => setNoteDate('')}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
            </div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input placeholder="Eje" value={noteAxis} onChange={(e) => setNoteAxis(e.target.value)} className="text-sm flex-1 h-9" />
              {noteAxis && <button className="p-1" onClick={() => setNoteAxis('')}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input placeholder="Dirección" value={noteAddress} onChange={(e) => setNoteAddress(e.target.value)} className="text-sm flex-1 h-9" />
              {noteAddress && <button className="p-1" onClick={() => setNoteAddress('')}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 text-xs text-muted-foreground rounded hover:bg-muted active:bg-muted/80 transition-colors"
              onClick={() => setShowTitleInput(!showTitleInput)}
            >
              Título
            </button>
            <span className="text-border">|</span>
            <button
              className="px-2 py-1 text-xs text-muted-foreground rounded hover:bg-muted active:bg-muted/80 transition-colors"
              onClick={() => setShowFields(!showFields)}
            >
              Campos{activeFieldCount > 0 ? ` (${activeFieldCount})` : ''}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 text-xs text-muted-foreground rounded hover:bg-muted"
              onClick={() => { setCurrentView('list'); fetchNotes() }}
            >
              <FileText className="h-4 w-4" />
            </button>
            <Button
              onClick={saveNote}
              disabled={!transcript.trim() || isSaving}
              size="sm"
              className="h-8 px-4 text-xs"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {isSaving ? '...' : 'Guardar'}
            </Button>
          </div>
        </div>

        {/* Mic button + safe area */}
        <div className="flex flex-col items-center pb-[max(env(safe-area-inset-bottom,8px),8px)] pt-1">
          <Button
            onClick={toggleRecording}
            disabled={!isSupported}
            className={`rounded-full w-14 h-14 shadow-lg transition-all duration-200 ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-foreground hover:bg-foreground/90 text-background'
            }`}
          >
            {isRecording ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>
          <p className="text-[10px] text-muted-foreground/50 mt-1 h-3">
            {isRecording ? 'tocar para pausar' : ''}
          </p>
        </div>
      </div>
    </div>
  )

  // ==================== NOTES LIST VIEW ====================
  const renderListView = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentView('dictation')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-bold">Mis Notas</h1>
          {notes.length > 0 && <Badge variant="secondary" className="text-[10px]">{notes.length}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {notes.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportNotes(notes)} className="h-8 gap-1 text-xs">
              <Download className="h-3.5 w-3.5" />
              Exportar
            </Button>
          )}
          <Button onClick={() => { resetForm(); setCurrentView('dictation') }} size="sm" className="h-8 gap-1 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Nueva
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">No hay notas aún.<br />Dicta tu primera nota.</p>
          <Button onClick={() => setCurrentView('dictation')} variant="outline" size="sm" className="gap-1.5">
            <Mic className="h-4 w-4" /> Dictar
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col p-3 gap-2">
            {notes.map((note) => (
              <Card
                key={note.id}
                className="cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => { setSelectedNote(note); setCurrentView('detail') }}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {note.title && <h3 className="font-medium text-sm truncate">{note.title}</h3>}
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{getPreview(note.content)}</p>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
                        {note.noteDate && <span className="flex items-center gap-0.5"><CalendarDays className="h-3 w-3" />{formatDateShort(note.noteDate)}</span>}
                        {note.axis && <span className="flex items-center gap-0.5"><GitBranch className="h-3 w-3" />Eje {note.axis}</span>}
                        {note.address && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{note.address}</span>}
                        <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDate(note.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      className="p-1.5 text-muted-foreground/50 hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(note.id) }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="h-4" />
        </ScrollArea>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar nota</AlertDialogTitle>
            <AlertDialogDescription>¿Estás seguro? Esta acción no se puede deshacer.</AlertDialogDescription>
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
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedNote(null); setCurrentView('list') }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            {selectedNote.title && <h1 className="font-bold text-sm truncate">{selectedNote.title}</h1>}
            <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              {selectedNote.noteDate && <span><CalendarDays className="h-3 w-3 inline" /> {formatDateShort(selectedNote.noteDate)}</span>}
              {selectedNote.axis && <span><GitBranch className="h-3 w-3 inline" /> Eje {selectedNote.axis}</span>}
              {selectedNote.address && <span><MapPin className="h-3 w-3 inline" /> {selectedNote.address}</span>}
            </div>
          </div>
          <button className="p-1.5 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(selectedNote.id)}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {(selectedNote.noteDate || selectedNote.axis || selectedNote.address) && (
          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b bg-muted/20 shrink-0">
            {selectedNote.noteDate && (
              <span className="flex items-center gap-1 px-2 py-1 bg-background rounded text-xs border">
                <CalendarDays className="h-3 w-3 text-primary" />{formatDateShort(selectedNote.noteDate)}
              </span>
            )}
            {selectedNote.axis && (
              <span className="flex items-center gap-1 px-2 py-1 bg-background rounded text-xs border">
                <GitBranch className="h-3 w-3 text-primary" />Eje {selectedNote.axis}
              </span>
            )}
            {selectedNote.address && (
              <span className="flex items-center gap-1 px-2 py-1 bg-background rounded text-xs border">
                <MapPin className="h-3 w-3 text-primary" />{selectedNote.address}
              </span>
            )}
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">{selectedNote.content}</div>
        </ScrollArea>

        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar nota</AlertDialogTitle>
              <AlertDialogDescription>¿Estás seguro? Esta acción no se puede deshacer.</AlertDialogDescription>
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
    <div className="h-dvh flex flex-col bg-background max-w-lg mx-auto">
      {/* Not supported banner */}
      {!isSupported && (
        <div className="shrink-0 bg-destructive/10 border-b border-destructive/20 px-4 py-2">
          <p className="text-xs text-destructive font-medium text-center">Reconocimiento de voz no disponible. Usa Chrome o Safari.</p>
        </div>
      )}

      {/* Error banner */}
      {recognitionError && (
        <div className="shrink-0 bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center justify-between">
          <p className="text-xs text-destructive">{recognitionError}</p>
          <button onClick={() => setRecognitionError('')}><X className="h-3.5 w-3.5 text-destructive" /></button>
        </div>
      )}

      {/* Main content fills the screen */}
      {currentView === 'dictation' && renderDictationView()}
      {currentView === 'list' && renderListView()}
      {currentView === 'detail' && renderDetailView()}
    </div>
  )
}