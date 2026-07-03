import { useState, type ReactNode } from 'react'

type CollapsibleBlockProps = {
  id?: string
  kicker: string
  title: string
  description?: string
  defaultOpen?: boolean
  actions?: ReactNode
  children: ReactNode
}

export function CollapsibleBlock({
  id,
  kicker,
  title,
  description,
  defaultOpen = true,
  actions,
  children,
}: CollapsibleBlockProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section id={id} className={`dash-block${open ? ' dash-block-open' : ' dash-block-closed'}`}>
      <header className="dash-block-head">
        <button
          type="button"
          className="dash-block-toggle"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <span className={`dash-block-chevron${open ? ' dash-block-chevron-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span className="dash-block-titles">
            <span className="dash-block-kicker">{kicker}</span>
            <span className="dash-block-title">{title}</span>
          </span>
        </button>
        {actions ? <div className="dash-block-actions">{actions}</div> : null}
      </header>
      {open ? (
        <div className="dash-block-body">
          {description ? <p className="dash-block-description">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  )
}
