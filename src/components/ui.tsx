import { ExternalLink, FileText } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { NOT_SPECIFIED, pdfPageUrl, sourceLabel, WINTER_STATUS_HELP, WINTER_STATUS_LABEL, type WinterStatus } from '../lib/domain'
import { STATUS_LABEL, type Status } from '../lib/rules'

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

type Tone = 'slate' | 'accent' | 'amber' | 'red' | 'blue' | 'violet'
const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}

export function Badge({ tone = 'slate', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONES[tone])}>
      {children}
    </span>
  )
}

export function WinterBadge({ status }: { status: WinterStatus }) {
  const tone: Record<WinterStatus, Tone> = { scheduled: 'accent', recurring: 'blue', summer: 'slate', uncertain: 'amber' }
  return (
    <Badge tone={tone[status]} title={WINTER_STATUS_HELP[status]}>
      {WINTER_STATUS_LABEL[status]}
    </Badge>
  )
}

const STATUS_TONE: Record<Status, Tone> = {
  valid: 'accent',
  incomplete: 'slate',
  conflict: 'red',
  approval: 'violet',
  unverifiable: 'amber',
}
export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-accent-500 text-white hover:bg-accent-600 border border-accent-500 disabled:bg-slate-300 disabled:border-slate-300',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 border border-transparent disabled:text-slate-300',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  }
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        v[variant],
        className,
      )}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg border border-slate-200 bg-white', className)}>{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function SourceLink({ page, end, className }: { page: number; end?: number; className?: string }) {
  return (
    <a
      href={pdfPageUrl(page)}
      target="_blank"
      rel="noreferrer"
      className={cx('inline-flex items-center gap-1 text-xs text-slate-500 hover:text-accent-700 hover:underline', className)}
      title="Open this page of the original PDF"
    >
      <FileText size={12} aria-hidden />
      {sourceLabel(page, end)}
      <ExternalLink size={11} aria-hidden />
    </a>
  )
}

export function PageRef({ page }: { page: number }) {
  return (
    <a href={pdfPageUrl(page)} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-accent-700 hover:underline">
      p. {page}
    </a>
  )
}

export function Missing() {
  return <span className="italic text-slate-400">{NOT_SPECIFIED}</span>
}

export function Val({ v }: { v: ReactNode | null | undefined }) {
  return v === null || v === undefined || v === '' ? <Missing /> : <>{v}</>
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-2 flex justify-center text-slate-400">{icon}</div>}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  )
}

export function SourceText({ text, className }: { text: string; className?: string }) {
  return <div className={cx('source-text text-sm leading-relaxed text-slate-700', className)}>{text}</div>
}
