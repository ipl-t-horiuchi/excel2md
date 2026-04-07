interface Props {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

export default function ActionButton({ label, icon, onClick, variant = 'primary' }: Props) {
  const base = 'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors focus:outline-none'
  const styles =
    variant === 'primary'
      ? `${base} bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800`
      : `${base} border border-brand-600 text-brand-700 bg-white hover:bg-brand-50`

  return (
    <button onClick={onClick} className={styles}>
      {icon}
      {label}
    </button>
  )
}
