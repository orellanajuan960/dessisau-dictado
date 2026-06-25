# VoiceNotes - Dictado de Voz

Aplicación web móvil para dictar notas por voz y guardarlas. Optimizada para uso en teléfono con reconocimiento de voz en tiempo real.

## Funcionalidades

- 🎤 **Dictado por voz** con Web Speech API (español)
- 📝 **Área de texto** que se llena en tiempo real mientras hablas
- 💾 **Guardado de notas** en base de datos PostgreSQL
- 📋 **Lista de notas** guardadas con preview
- 🗑️ **Eliminar notas** con confirmación
- 📱 **Optimizado para móvil** con safe area iOS

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Lenguaje**: TypeScript
- **Estilos**: Tailwind CSS 4 + shadcn/ui
- **Base de datos**: PostgreSQL (Neon) via Prisma ORM
- **Voz**: Web Speech API del navegador

## Requisitos

- Node.js 18+ o Bun
- Navegador Chrome o Safari (para reconocimiento de voz)

## Instalación local

```bash
# Clonar el repositorio
git clone https://github.com/orellanajuan960/dessisau-dictado.git
cd dessisau-dictado

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu DATABASE_URL

# Sincronizar base de datos
npx prisma db push

# Iniciar desarrollo
npm run dev
```

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | URL de conexión a PostgreSQL (Neon) |

## Deploy en Vercel

1. Conectar el repositorio a [Vercel](https://vercel.com)
2. Configurar la variable `DATABASE_URL` en Vercel con la URL de Neon
3. Hacer deploy

Vercel ejecutará automáticamente `postinstall` (prisma generate) y `build`.