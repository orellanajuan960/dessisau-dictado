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
import { Mic, MicOff, Save, Trash2, FileText, ArrowLeft, Plus, Clock, CalendarDays, X } from 'lucide-react'

type SpeechRecognitionInstance = any

interface Note {
  id: string
  title: string | null
  content: string
  noteDate: string | null
  createdAt: string
  updatedAt: string
}

type View = 'dictation' | 'list' | 'detail'

// Parse date patterns from text like "20 06 2026", "20/06/2026", "20-06-2026"
function parseDateFromText(text: string): Date | null {
  // Pattern: dd mm yyyy or dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const patterns = [
    // "20 06 2026" or "20 06 26"
    /(\d{1,2})[\s./\-]+(\d{1,2})[\s./\-]+(\d{2,4})/,
    // "fecha 20 de junio de 2026" etc (basic)
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{2,4})/i,
  ]

  const monthNames: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  }

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      if (pattern === patterns[1]) {
        // Named month pattern
        const day = parseInt(match[1], 10)
        const month = monthNames[match[2].toLowerCase()]
        let year = parseInt(match[3], 10)
        if (year < 100) year += 2000
        if (day >= 1 && day <= 31 && month !== undefined) {
          const d = new Date(year, month, day)
          if (!isNaN(d.getTime())) return d
        }
      } else {
        // Numeric pattern
        const a = parseInt(match[1], 10)
        const b = parseInt(match[2], 10)
        let c = parseInt(match[3], 10)
        if (c < 100) c += 2000

        // Try dd mm yyyy first, then mm dd yyyy
        const attempts = [
          new Date(c, b - 1, a),  // dd mm yyyy
          new Date(c, a - 1, b),  // mm dd yyyy
        ]

        for (const d of attempts) {
          if (!isNaN(d.getTime()) && d.getDate() === a && d.getMonth() === b - 1) {
            return d
          }
          if (!isNaN(d.getTime()) && d.getDate() === b && d.getMonth() === a - 1) {
            return d
          }
        }
      }
    }
  }

  return null
}

// Remove detected date from text content
function removeDateFromText(text: string): string {
  const patterns = [
    /fecha\s+\d{1,2}[\s./\-]+\d{1,2}[\s./\-]+\d{2,4}\s*/gi,
    /\d{1,2}[\s./\-]+\d{1,2}[\s./\-]+\d{2,4}\s*/g,
    /\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{2,4}\s*/gi,
  ]

  let cleaned = text
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '').trim()
  }
  // Clean up double spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
  return cleaned
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteDate, setNoteDate] = useState('')
  const [showTitleInput, setShowTitleInput] = useState(false)
  const [showDateInput, setShowDateInput] = useState(false)
  const [detectedDateFromVoice, setDetectedDateFromVoice] = useState(false)

  const [notes, setNotes] = useState<Note[]>([])
  const [currentView, setCurrentView] = useState<View>('dictation')
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(true)
  const [interimText, setInterimText] = useState('')
  const [recognitionError, setRecognitionError] = useState('')

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const userEditedTitle = useRef(false)
  const { toast } = useToast()

  // Check browser support
  useEffect(() => {
    const SR =
      typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>).SpeechRecognition ||
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition
        : null
    if (!SR) setIsSupported(false)
  }, [])

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/notes')
      if (res.ok) setNotes(await res.json())
    } catch {
      toast({
        title: 'Error',
        description: 'No se pudieron cargar las notas guardadas.',
        variant: 'destructive',
      })
    }
  }, [toast])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // Detect date from transcript
  useEffect(() => {
    if (!transcript.trim()) return
    const parsed = parseDateFromText(transcript)
    if (parsed && !detectedDateFromVoice) {
      // Format as YYYY-MM-DD for the input[type=date]
      const yyyy = parsed.getFullYear()
      const mm = String(parsed.getMonth() + 1).padStart(2, '0')
      const dd = String(parsed.getDate()).padStart(2, '0')
      setNoteDate(`${yyyy}-${mm}-${dd}`)
      setDetectedDateFromVoice(true)
      // Clean the date from the transcript content
      const cleaned = removeDateFromText(transcript)
      if (cleaned !== transcript) {
        setTranscript(cleaned)
      }
    }
  }, [transcript, detectedDateFromVoice])

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
        setRecognitionError('Permiso de micrófono denegado. Por favor permite el acceso al micrófono.')
        setIsRecording(false)
      } else if (event.error === 'no-speech') {
        if (isRecording) {
          restartTimeoutRef.current = setTimeout(() => {
            try { recognition.start() } catch { /* ignore */ }
          }, 500)
        }
      } else if (event.error === 'network') {
        setRecognitionError('Error de red. Verifica tu conexión a internet.')
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
      toast({
        title: 'Error',
        description: 'No se pudo iniciar el reconocimiento de voz.',
        variant: 'destructive',
      })
    }
  }, [transcript, isRecording, recognitionError, toast])

  const stopRecognition = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsRecording(false)
    setInterimText('')
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecognition()
    } else {
      startRecognition()
    }
  }, [isRecording, startRecognition, stopRecognition])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
      if (recognitionRef.current) recognitionRef.current.stop()
    }
  }, [])

  const handleTitleChange = (value: string) => {
    userEditedTitle.current = true
    setNoteTitle(value)
  }

  const saveNote = async () => {
    const trimmed = transcript.trim()
    if (!trimmed) {
      toast({
        title: 'Nota vacía',
        description: 'Dicta algo antes de guardar.',
        variant: 'destructive',
      })
      return
    }

    setIsSaving(true)
    try {
      const body: Record<string, string | null> = {
        content: trimmed,
        title: noteTitle.trim() || null,
        noteDate: noteDate || null,
      }

      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast({ title: 'Nota guardada', description: 'Tu nota se ha guardado exitosamente.' })
        // Reset everything
        setTranscript('')
        setNoteTitle('')
        setNoteDate('')
        setShowTitleInput(false)
        setShowDateInput(false)
        setDetectedDateFromVoice(false)
        userEditedTitle.current = false
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

  const deleteNote = async (id: string) => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Eliminada', description: 'La nota ha sido eliminada.' })
        setNotes((prev) => prev.filter((n) => n.id !== id))
        if (selectedNote?.id === id) {
          setSelectedNote(null)
          setCurrentView('list')
        }
      }
    } catch {
      toast({
        title: 'Error',
        description: 'No se pudo eliminar la nota.',
        variant: 'destructive',
      })
    }
    setDeleteTarget(null)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('es-VE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('es-VE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const getPreview = (content: string) => {
    return content.length > 100 ? content.substring(0, 100) + '...' : content
  }

  const displayText = useMemo(() => {
    const base = transcript.trim()
    const interim = interimText.trim()
    return interim ? base + (base ? ' ' : '') + interim : base
  }, [transcript, interimText])

  // ==================== DICTATION VIEW ====================
  const renderDictationView = () => (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Dictado de Voz</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setCurrentView('list'); fetchNotes() }}
          className="gap-1.5 text-sm"
        >
          <FileText className="h-4 w-4" />
          Mis Notas
          {notes.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">{notes.length}</Badge>
          )}
        </Button>
      </div>

      {/* Not supported warning */}
      {!isSupported && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4">
            <p className="text-sm text-destructive font-medium">
              Tu navegador no soporta el reconocimiento de voz. Intenta usar Google Chrome o Safari.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error message */}
      {recognitionError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-start justify-between gap-2">
            <p className="text-sm text-destructive">{recognitionError}</p>
            <Button variant="ghost" size="sm" onClick={() => setRecognitionError('')} className="shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Title input */}
      {showTitleInput && (
        <Input
          placeholder="Título de la nota (opcional)"
          value={noteTitle}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="text-base"
          autoFocus
        />
      )}

      {/* Date input */}
      {showDateInput && (
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            type="date"
            value={noteDate}
            onChange={(e) => {
              setNoteDate(e.target.value)
              if (e.target.value) setDetectedDateFromVoice(true)
            }}
            className="text-base flex-1"
          />
          {noteDate && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={() => { setNoteDate(''); setDetectedDateFromVoice(false) }}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      )}

      {/* Detected date banner (when not showing input but date was detected) */}
      {!showDateInput && noteDate && (
        <div
          className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm cursor-pointer"
          onClick={() => setShowDateInput(true)}
        >
          <CalendarDays className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">Fecha detectada: </span>
          <span className="font-medium">{formatDateShort(noteDate)}</span>
        </div>
      )}

      {/* Text area */}
      <div className="flex-1 min-h-0 relative">
        <Textarea
          ref={textareaRef}
          value={displayText}
          onChange={(e) => {
            if (!isRecording) setTranscript(e.target.value)
          }}
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
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTitleInput(!showTitleInput)}
            className="text-xs text-muted-foreground"
          >
            {showTitleInput ? 'Ocultar título' : 'Agregar título'}
          </Button>
          <span className="text-muted-foreground/40">|</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDateInput(!showDateInput)}
            className="text-xs text-muted-foreground"
          >
            {showDateInput ? 'Ocultar fecha' : noteDate ? 'Editar fecha' : 'Agregar fecha'}
          </Button>
        </div>

        <Button
          onClick={saveNote}
          disabled={!transcript.trim() || isSaving}
          className="gap-2"
          size="lg"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>

      {/* Floating mic button - mobile */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:static md:translate-x-0 md:z-auto md:mx-auto md:mb-0">
        <Button
          onClick={toggleRecording}
          disabled={!isSupported}
          size="lg"
          className={`rounded-full w-16 h-16 md:w-20 md:h-20 shadow-xl transition-all duration-300 ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
        >
          {isRecording ? (
            <MicOff className="h-7 w-7 md:h-8 md:w-8" />
          ) : (
            <Mic className="h-7 w-7 md:h-8 md:w-8" />
          )}
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setCurrentView('dictation')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">Mis Notas</h1>
        </div>
        <Button
          onClick={() => {
            setTranscript('')
            setNoteTitle('')
            setNoteDate('')
            setShowTitleInput(false)
            setShowDateInput(false)
            setDetectedDateFromVoice(false)
            userEditedTitle.current = false
            setCurrentView('dictation')
          }}
          size="sm"
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-medium text-muted-foreground">No hay notas</p>
            <p className="text-sm text-muted-foreground mt-1">
              Dicta tu primera nota presionando el botón del micrófono.
            </p>
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
                      {note.title && (
                        <h3 className="font-semibold text-sm truncate">{note.title}</h3>
                      )}
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {getPreview(note.content)}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {note.noteDate && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {formatDateShort(note.noteDate)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(note.createdAt)}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
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

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar nota</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres eliminar esta nota? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteNote(deleteTarget)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
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
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setSelectedNote(null); setCurrentView('list') }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            {selectedNote.title && (
              <h1 className="text-lg font-bold truncate">{selectedNote.title}</h1>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {selectedNote.noteDate && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {formatDateShort(selectedNote.noteDate)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(selectedNote.createdAt)}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteTarget(selectedNote.id)}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>

        <Separator />

        {/* Content */}
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="whitespace-pre-wrap text-base leading-relaxed pb-4">
            {selectedNote.content}
          </div>
        </ScrollArea>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar nota</AlertDialogTitle>
              <AlertDialogDescription>
                ¿Estás seguro de que quieres eliminar esta nota? Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteTarget && deleteNote(deleteTarget)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
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

      {/* Main content */}
      <main className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 pb-24 md:pb-4">
        {currentView === 'dictation' && renderDictationView()}
        {currentView === 'list' && renderListView()}
        {currentView === 'detail' && renderDetailView()}
      </main>
    </div>
  )
}